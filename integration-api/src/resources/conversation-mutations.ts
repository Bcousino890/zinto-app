import type pg from "pg";

import { iso, type ConversationResource, type Timestamp } from "./core.js";

export type ConversationCreateFailure = "contact_not_found" | "channel_not_found";

/**
 * Dos finales correctos distintos (la conversacion ya existia / se acaba de
 * crear) se traducen a dos codigos de estado distintos, asi que el repositorio
 * devuelve un resultado discriminado en vez del `null` que usan las operaciones
 * con un unico motivo de fallo.
 */
export type ConversationCreateResult =
  | { ok: true; created: boolean; conversation: ConversationResource }
  | { ok: false; reason: ConversationCreateFailure };

export interface ConversationMutationRepository {
  findOrCreateConversation(
    companyId: number,
    contactId: number,
    channelId: number,
    userId: number
  ): Promise<ConversationCreateResult>;
}

interface ConversationRow {
  id: number;
  contact_id: number | null;
  channel_id: number;
  channel_type: string;
  status: string | null;
  assigned_to_user_id: number | null;
  last_message_at: Timestamp;
  unread_count: number | null;
  bot_disabled: boolean | null;
  is_archived: boolean | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/**
 * Mismo juego de columnas que lee `listConversations`, para que crear una
 * conversacion y listarla devuelvan exactamente el mismo recurso.
 */
const CONVERSATION_COLUMNS = `id, contact_id, channel_id, channel_type, status, assigned_to_user_id,
  last_message_at, unread_count, bot_disabled, is_archived, created_at, updated_at`;

function conversation(row: ConversationRow): ConversationResource {
  return {
    id: String(row.id),
    contact_id: row.contact_id === null ? null : String(row.contact_id),
    channel_id: String(row.channel_id),
    channel_type: row.channel_type,
    status: row.status ?? "open",
    assigned_to_user_id: row.assigned_to_user_id === null ? null : String(row.assigned_to_user_id),
    last_message_at: iso(row.last_message_at),
    unread_count: row.unread_count ?? 0,
    bot_disabled: row.bot_disabled ?? false,
    archived: row.is_archived ?? false,
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!
  };
}

/**
 * Clave del advisory lock. Concatenar los dos enteros con `:` es inyectivo: los
 * digitos no pueden formar el separador, asi que ningun par distinto de ids
 * produce la misma cadena (`1:23` y `12:3` son cadenas distintas).
 *
 * No hace falta meter `company_id` en la clave: `contact_id` es la clave
 * primaria de `contacts`, de modo que un contacto pertenece a una sola empresa
 * y dos empresas nunca compiten por la misma pareja.
 */
export function conversationLockKey(contactId: number, channelId: number): string {
  return `${contactId}:${channelId}`;
}

export class PostgresConversationMutationRepository implements ConversationMutationRepository {
  constructor(private readonly pool: pg.Pool) {}

  private async transaction<T>(operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('zinto.integration_api_origin', 'api', true)");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async record(
    client: pg.PoolClient,
    companyId: number,
    userId: number | null,
    eventType: string,
    resourceType: string,
    resourceId: number,
    payload: unknown
  ): Promise<void> {
    await client.query(
      `INSERT INTO integration_api_audit_records
         (company_id, actor_user_id, action, resource_type, resource_id, new_values)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [companyId, userId, eventType, resourceType, resourceId, JSON.stringify(payload)]
    );
    await client.query(
      `INSERT INTO integration_api_outbox
         (company_id, event_type, resource_type, resource_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [companyId, eventType, resourceType, resourceId, JSON.stringify(payload)]
    );
  }

  /**
   * Devuelve la conversacion 1:1 de un contacto en un canal, creandola si no
   * existe, sin poder duplicarla bajo concurrencia.
   *
   * `conversations` **no tiene** ninguna restriccion `UNIQUE` sobre
   * `(contact_id, channel_id)`, solo el indice no-unico
   * `idx_conversations_contact_channel` (esquema real verificado en staging
   * aislado de solo lectura, ver `docs/api/SCHEMA-VERIFICATION-2026-08-13-02.md`
   * seccion 2). Sin restriccion no hay `INSERT ... ON CONFLICT` en el que
   * apoyarse, y un `SELECT` seguido de un `INSERT` condicional **no basta**: dos
   * transacciones concurrentes con la misma pareja pasan ambas el `SELECT` sin
   * ver la fila de la otra —todavia sin `COMMIT`— y acaban insertando dos
   * conversaciones para el mismo contacto y canal.
   *
   * La solucion, especificada en ese documento, es un advisory lock de
   * transaccion como **primera** sentencia: las dos peticiones se serializan por
   * la clave, la segunda espera al `COMMIT`/`ROLLBACK` de la primera (momento en
   * que Postgres libera el lock solo) y su propio `SELECT`, ya despues del lock,
   * si ve la fila recien creada. No se anade un indice unico a proposito:
   * `conversations` es del CRM compartido y otras rutas del motor legacy
   * insertan en ella sin pasar por este codigo.
   */
  async findOrCreateConversation(
    companyId: number,
    contactId: number,
    channelId: number,
    userId: number
  ): Promise<ConversationCreateResult> {
    return this.transaction(async (client) => {
      // Primera sentencia de la transaccion, antes de cualquier lectura o
      // escritura de `conversations`. Tomarlo antes de validar contacto y canal
      // es deliberado: mantiene la ventana serializada cubriendo toda la
      // operacion y el lock se suelta igual al terminar la transaccion.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        conversationLockKey(contactId, channelId)
      ]);

      // Aislamiento estricto por empresa en las dos validaciones: un id ajeno y
      // uno inexistente son indistinguibles para el partner. `company_id` es
      // NULL-able en el esquema, asi que el filtro es estricto, nunca laxo.
      const contacts = await client.query<{ id: number }>(
        `SELECT id FROM contacts
          WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [contactId, companyId]
      );
      if (contacts.rows[0] === undefined) return { ok: false, reason: "contact_not_found" };

      // `channel_type` se deriva siempre del canal real leido aqui, nunca de la
      // peticion: es la unica forma de que no pueda desincronizarse de
      // `channel_connections`.
      const channels = await client.query<{ id: number; channel_type: string }>(
        `SELECT id, channel_type FROM channel_connections
          WHERE id = $1 AND company_id = $2`,
        [channelId, companyId]
      );
      const channel = channels.rows[0];
      if (channel === undefined) return { ok: false, reason: "channel_not_found" };

      // `ORDER BY id ASC LIMIT 1` y no un `LIMIT 1` a secas: sin restriccion
      // unica la tabla puede tener ya duplicados creados por el motor legacy
      // antes de que existiera este endpoint, y la respuesta tiene que ser
      // estable entre llamadas. Se devuelve siempre la mas antigua.
      //
      // Filtrar por `contact_id` ya excluye las conversaciones de grupo: el
      // CHECK `check_conversation_type` exige `contact_id IS NULL` cuando
      // `is_group = true`, asi que una fila de grupo no puede casar aqui.
      const existing = await client.query<ConversationRow>(
        `SELECT ${CONVERSATION_COLUMNS}
           FROM conversations
          WHERE contact_id = $1 AND channel_id = $2 AND company_id = $3
          ORDER BY id ASC
          LIMIT 1`,
        [contactId, channelId, companyId]
      );
      const found = existing.rows[0];
      // Encontrarla no es un cambio de estado: no se audita ni se emite evento,
      // porque no ha pasado nada que notificar.
      if (found !== undefined) return { ok: true, created: false, conversation: conversation(found) };

      // Solo estas cuatro columnas: el resto toma su DEFAULT. En particular
      // `is_group` se queda en `false` y `group_jid` en NULL, que es justo la
      // rama 1:1 del CHECK `check_conversation_type` — se cumple sin fijarlo.
      const inserted = await client.query<ConversationRow>(
        `INSERT INTO conversations (company_id, contact_id, channel_id, channel_type)
         VALUES ($1, $2, $3, $4)
         RETURNING ${CONVERSATION_COLUMNS}`,
        [companyId, contactId, channelId, channel.channel_type]
      );
      const resource = conversation(inserted.rows[0]!);
      await this.record(
        client,
        companyId,
        userId,
        "conversation.created",
        "conversation",
        Number(resource.id),
        resource
      );
      return { ok: true, created: true, conversation: resource };
    });
  }
}
