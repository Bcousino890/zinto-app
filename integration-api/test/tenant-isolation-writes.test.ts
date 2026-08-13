import type pg from "pg";
import { describe, expect, it } from "vitest";

import { PostgresContactMutationRepository } from "../src/resources/contact-mutations.js";
import { PostgresConversationMutationRepository } from "../src/resources/conversation-mutations.js";
import { PostgresPipelineMutationRepository } from "../src/resources/pipeline-mutations.js";

/**
 * Aislamiento multiempresa de las rutas de ESCRITURA, comprobado por
 * comportamiento y no solo por el texto del SQL.
 *
 * Los dobles de `pipeline-mutation-repository.test.ts` y
 * `conversation-mutation-repository.test.ts` responden por forma de consulta:
 * devuelven la fila que el fixture les da, sin mirar los parametros. Eso fija
 * muy bien la forma del SQL, pero no puede fallar si alguien borra un
 * `AND company_id = $2`: el doble seguiria devolviendo la misma fila.
 *
 * Este doble es distinto a proposito. Guarda filas de DOS empresas con
 * identificadores que colisionan como colisionarian en un ataque real, y
 * responde cada consulta aplicando **exactamente** los predicados de empresa
 * que el SQL de produccion trae escritos. Si una consulta deja de filtrar por
 * empresa, el doble deja de filtrar tambien, devuelve la fila ajena y estas
 * pruebas fallan. Es la unica forma de que una regresion de aislamiento se
 * note aqui en vez de en produccion.
 */

interface Call {
  text: string;
  params: unknown[];
}

interface Rows {
  rows: unknown[];
}

const A = 12;
const B = 77;

const flat = (text: string): string => text.replace(/\s+/g, " ").trim();
const has = (text: string, clause: string): boolean => flat(text).includes(clause);

const at = new Date("2026-08-13T10:00:00.000Z");

interface DealRecord {
  id: number;
  company_id: number;
  pipeline_id: number;
  stage_id: number | null;
}

interface PipelineRecord {
  id: number;
  company_id: number;
}

interface StageRecord {
  id: number;
  company_id: number;
  pipeline_id: number;
  name: string;
}

interface ContactRecord {
  id: number;
  company_id: number;
  name: string;
  deleted: boolean;
}

interface ChannelRecord {
  id: number;
  company_id: number;
  channel_type: string;
}

interface ConversationRecord {
  id: number;
  company_id: number;
  contact_id: number;
  channel_id: number;
  channel_type: string;
}

interface NoteRecord {
  id: number;
  contact_id: number;
  content: string;
}

/**
 * Deal 403 y pipeline 31 son de la empresa A. Pipeline 88 es de B.
 *
 * Las tres etapas son el nucleo del ejercicio:
 * - 311 es legitima (empresa A, pipeline 31 de A).
 * - 900 es descaradamente ajena (empresa B, pipeline 88 de B).
 * - 901 es la interesante: su propia `company_id` dice A, pero cuelga del
 *   pipeline 88, que es de B. Solo la cadena completa la rechaza; comprobar
 *   unicamente `pipeline_stages.company_id` la dejaria pasar.
 */
const deals: DealRecord[] = [
  { id: 403, company_id: A, pipeline_id: 31, stage_id: 310 },
  { id: 950, company_id: B, pipeline_id: 88, stage_id: 900 }
];

const pipelines: PipelineRecord[] = [
  { id: 31, company_id: A },
  { id: 88, company_id: B }
];

const stages: StageRecord[] = [
  { id: 310, company_id: A, pipeline_id: 31, name: "Lead" },
  { id: 311, company_id: A, pipeline_id: 31, name: "Propuesta" },
  { id: 900, company_id: B, pipeline_id: 88, name: "Etapa privada de B" },
  { id: 901, company_id: A, pipeline_id: 88, name: "Etapa con cadena rota" }
];

const contacts: ContactRecord[] = [
  { id: 101, company_id: A, name: "Contacto propio", deleted: false },
  { id: 500, company_id: B, name: "Contacto de otra empresa", deleted: false }
];

const channels: ChannelRecord[] = [
  { id: 55, company_id: A, channel_type: "whatsapp_official" },
  { id: 44, company_id: B, channel_type: "whatsapp" }
];

/**
 * Conversacion 7002: fila mal atribuida a proposito. Apunta al contacto 101 y
 * al canal 55, ambos de A, pero su `company_id` dice B. Es la colision que
 * puede existir de verdad en un CRM compartido donde otras rutas del motor
 * legacy insertan en esta tabla sin pasar por este codigo.
 */
const conversations: ConversationRecord[] = [
  { id: 7002, company_id: B, contact_id: 101, channel_id: 55, channel_type: "whatsapp_official" },
  { id: 7003, company_id: B, contact_id: 500, channel_id: 44, channel_type: "whatsapp" }
];

const notes: NoteRecord[] = [
  { id: 800, contact_id: 101, content: "Nota propia" },
  { id: 900, contact_id: 500, content: "Nota privada de otra empresa" }
];

function dealRow(deal: DealRecord, stageId: number): unknown {
  return {
    id: deal.id,
    pipeline_id: deal.pipeline_id,
    contact_id: 101,
    title: "Renovación anual",
    stage: "proposal",
    stage_id: stageId,
    value: null,
    priority: null,
    status: null,
    due_date: null,
    assigned_to_user_id: null,
    description: null,
    tags: null,
    custom_fields: null,
    last_activity_at: at,
    created_at: at,
    updated_at: at
  };
}

function conversationRow(row: ConversationRecord): unknown {
  return {
    id: row.id,
    contact_id: row.contact_id,
    channel_id: row.channel_id,
    channel_type: row.channel_type,
    status: "open",
    assigned_to_user_id: null,
    last_message_at: at,
    unread_count: 0,
    bot_disabled: false,
    is_archived: false,
    created_at: at,
    updated_at: at
  };
}

function contactRow(row: ContactRecord): unknown {
  return {
    id: row.id,
    name: row.name,
    email: null,
    phone: null,
    avatar_url: null,
    company: null,
    tags: ["vip"],
    source: null,
    notes: null,
    custom_fields: null,
    is_archived: false,
    created_at: at,
    updated_at: at
  };
}

function noteRow(row: NoteRecord): unknown {
  return {
    id: row.id,
    contact_id: row.contact_id,
    created_by_id: 7,
    content: row.content,
    created_at: at,
    updated_at: at
  };
}

/**
 * Doble del CRM compartido. Cada rama aplica el predicado de empresa **solo si
 * el SQL de produccion lo trae**, de modo que quitar un filtro en `src/` hace
 * que la fila ajena vuelva a estar al alcance y la prueba correspondiente
 * falle.
 */
class FakeCrm {
  calls: Call[] = [];
  releases = 0;
  inserted: { table: string; params: unknown[] }[] = [];

  private answer(text: string, params: unknown[]): Rows {
    const empty: Rows = { rows: [] };

    // --- pipeline-mutations ------------------------------------------------
    if (text.includes("FROM deals")) {
      const deal = deals.find((row) => row.id === params[0]);
      if (deal === undefined) return empty;
      if (has(text, "company_id = $2") && deal.company_id !== params[1]) return empty;
      return { rows: [{ id: deal.id, pipeline_id: deal.pipeline_id, stage_id: deal.stage_id }] };
    }

    if (text.includes("FROM pipeline_stages")) {
      const stage = stages.find((row) => row.id === params[0]);
      if (stage === undefined) return empty;
      if (has(text, "pipeline_stages.company_id = $2") && stage.company_id !== params[1]) return empty;
      // El JOIN es INNER: sin pipeline padre no hay fila, con filtro o sin el.
      const pipeline = pipelines.find((row) => row.id === stage.pipeline_id);
      if (pipeline === undefined) return empty;
      if (has(text, "pipelines.company_id = $2") && pipeline.company_id !== params[1]) return empty;
      return { rows: [{ id: stage.id, pipeline_id: stage.pipeline_id, name: stage.name }] };
    }

    if (text.includes("UPDATE deals")) {
      const deal = deals.find((row) => row.id === params[0]);
      if (deal === undefined) return empty;
      if (has(text, "company_id = $2") && deal.company_id !== params[1]) return empty;
      this.inserted.push({ table: "deals", params });
      return { rows: [dealRow(deal, params[2] as number)] };
    }

    if (text.includes("INSERT INTO deal_activities")) {
      this.inserted.push({ table: "deal_activities", params });
      return empty;
    }

    // --- conversation-mutations -------------------------------------------
    if (text.includes("FROM channel_connections")) {
      const channel = channels.find((row) => row.id === params[0]);
      if (channel === undefined) return empty;
      if (has(text, "company_id = $2") && channel.company_id !== params[1]) return empty;
      return { rows: [{ id: channel.id, channel_type: channel.channel_type }] };
    }

    if (text.includes("FROM conversations")) {
      const found = conversations.find(
        (row) => row.contact_id === params[0] && row.channel_id === params[1]
      );
      if (found === undefined) return empty;
      if (has(text, "company_id = $3") && found.company_id !== params[2]) return empty;
      return { rows: [conversationRow(found)] };
    }

    if (text.includes("INSERT INTO conversations")) {
      this.inserted.push({ table: "conversations", params });
      return {
        rows: [conversationRow({
          id: 7100,
          company_id: params[0] as number,
          contact_id: params[1] as number,
          channel_id: params[2] as number,
          channel_type: params[3] as string
        })]
      };
    }

    // --- contact-mutations -------------------------------------------------
    // Antes que la rama generica de `contacts`: este INSERT lleva su propio
    // `FROM contacts` dentro del SELECT que lo alimenta.
    if (text.includes("INSERT INTO notes")) {
      const contact = contacts.find((row) => row.id === params[0]);
      if (contact === undefined) return empty;
      if (has(text, "contacts.company_id = $2") && contact.company_id !== params[1]) return empty;
      if (has(text, "contacts.deleted_at IS NULL") && contact.deleted) return empty;
      this.inserted.push({ table: "notes", params });
      return { rows: [noteRow({ id: 801, contact_id: contact.id, content: params[3] as string })] };
    }

    if (text.includes("UPDATE notes") || text.includes("DELETE FROM notes")) {
      const note = notes.find((row) => row.id === params[0]);
      if (note === undefined) return empty;
      // El join con `contacts` es la unica via de empresa: `notes` no tiene
      // `company_id` propio en el esquema real.
      const contact = contacts.find((row) => row.id === note.contact_id);
      if (contact === undefined) return empty;
      if (has(text, "notes.contact_id = contacts.id") && has(text, "contacts.company_id = $2") &&
          contact.company_id !== params[1]) return empty;
      this.inserted.push({ table: "notes:write", params });
      return { rows: [noteRow(note)] };
    }

    if (text.includes("INSERT INTO contacts")) {
      this.inserted.push({ table: "contacts", params });
      return { rows: [contactRow({ id: 600, company_id: params[0] as number, name: params[1] as string, deleted: false })] };
    }

    if (text.includes("UPDATE contacts")) {
      const contact = contacts.find((row) => row.id === params[0]);
      if (contact === undefined) return empty;
      if (has(text, "company_id = $2") && contact.company_id !== params[1]) return empty;
      if (has(text, "deleted_at IS NULL") && contact.deleted) return empty;
      this.inserted.push({ table: "contacts:write", params });
      return { rows: [contactRow(contact)] };
    }

    if (text.includes("FROM contacts")) {
      const contact = contacts.find((row) => row.id === params[0]);
      if (contact === undefined) return empty;
      if (has(text, "company_id = $2") && contact.company_id !== params[1]) return empty;
      if (has(text, "deleted_at IS NULL") && contact.deleted) return empty;
      return { rows: [{ id: contact.id }] };
    }

    if (text.includes("integration_api_audit_records")) {
      this.inserted.push({ table: "audit", params });
      return empty;
    }
    if (text.includes("integration_api_outbox")) {
      this.inserted.push({ table: "outbox", params });
      return empty;
    }

    return empty;
  }

  async connect(): Promise<pg.PoolClient> {
    const client = {
      query: async (text: string, params: unknown[] = []): Promise<Rows> => {
        this.calls.push({ text, params });
        return this.answer(text, params);
      },
      release: (): void => {
        this.releases += 1;
      }
    };
    return client as unknown as pg.PoolClient;
  }
}

function crm() {
  const pool = new FakeCrm();
  const cast = pool as unknown as pg.Pool;
  return {
    pool,
    deals: new PostgresPipelineMutationRepository(cast),
    conversations: new PostgresConversationMutationRepository(cast),
    contacts: new PostgresContactMutationRepository(cast)
  };
}

const wrote = (pool: FakeCrm, table: string): boolean =>
  pool.inserted.some((entry) => entry.table === table);
const sql = (pool: FakeCrm, fragment: string): Call | undefined =>
  pool.calls.find((call) => call.text.includes(fragment));

/** Mismo guardia que el resto de la suite: filtro estricto, nunca laxo. */
function expectStrictCompanyFilter(call: Call, placeholder: string): void {
  expect(flat(call.text)).toContain(`company_id = ${placeholder}`);
  expect(call.text).not.toMatch(/company_id\s+IS\s+NULL/i);
  expect(call.text).not.toMatch(/OR\s+\w*\.?company_id/i);
}

/** Ninguna escritura del CRM ni rastro auditable debe haber ocurrido. */
function expectNothingWritten(pool: FakeCrm): void {
  expect(pool.inserted).toEqual([]);
}

describe("PATCH /deals/:id/stage under a cross-company attack", () => {
  it("moves the deal when the whole chain belongs to the caller", async () => {
    // Control positivo: sin el, las pruebas de abajo pasarian aunque el doble
    // se negase a devolver cualquier fila.
    const { pool, deals: repository } = crm();

    const result = await repository.changeDealStage(A, 403, 7, 311);

    expect(result.ok).toBe(true);
    expect(wrote(pool, "deals")).toBe(true);
    expect(wrote(pool, "deal_activities")).toBe(true);
    expect(wrote(pool, "outbox")).toBe(true);
  });

  it("refuses a stage whose own row claims our company but whose pipeline is another company's", async () => {
    // La etapa 901 pasa `pipeline_stages.company_id = A` y solo la cae el
    // segundo salto de la cadena: su pipeline 88 es de B.
    const { pool, deals: repository } = crm();

    const result = await repository.changeDealStage(A, 403, 7, 901);

    expect(result).toEqual({ ok: false, reason: "stage_not_found" });
    expect(sql(pool, "UPDATE deals")).toBeUndefined();
    expectNothingWritten(pool);
  });

  it("refuses a stage that exists only inside another company", async () => {
    const { pool, deals: repository } = crm();

    const result = await repository.changeDealStage(A, 403, 7, 900);

    expect(result).toEqual({ ok: false, reason: "stage_not_found" });
    expect(sql(pool, "UPDATE deals")).toBeUndefined();
    expectNothingWritten(pool);
  });

  it("refuses a deal that exists only inside another company", async () => {
    const { pool, deals: repository } = crm();

    const result = await repository.changeDealStage(A, 950, 7, 311);

    expect(result).toEqual({ ok: false, reason: "deal_not_found" });
    expect(sql(pool, "FROM pipeline_stages")).toBeUndefined();
    expectNothingWritten(pool);
  });

  it("cannot move another company's deal even naming that company's own stage", async () => {
    // El par (950, 900) es internamente coherente dentro de B: si el filtro de
    // empresa se cayese del primer SELECT, esta llamada moveria un deal ajeno.
    const { pool, deals: repository } = crm();

    const result = await repository.changeDealStage(A, 950, 7, 900);

    expect(result).toEqual({ ok: false, reason: "deal_not_found" });
    expectNothingWritten(pool);
  });

  it("answers a foreign stage and an absent stage with the very same reason", async () => {
    const foreign = await crm().deals.changeDealStage(A, 403, 7, 900);
    const absent = await crm().deals.changeDealStage(A, 403, 7, 424_242);

    expect(foreign).toEqual(absent);
  });

  it("keeps the strict company filter on every statement that names an identifier", async () => {
    const { pool, deals: repository } = crm();

    await repository.changeDealStage(A, 403, 7, 311);

    expectStrictCompanyFilter(sql(pool, "FROM deals")!, "$2");
    expectStrictCompanyFilter(sql(pool, "UPDATE deals")!, "$2");
    const stage = sql(pool, "FROM pipeline_stages")!;
    expect(flat(stage.text)).toContain("pipeline_stages.company_id = $2");
    expect(flat(stage.text)).toContain("pipelines.company_id = $2");
    expect(stage.text).not.toMatch(/company_id\s+IS\s+NULL/i);
  });
});

describe("POST /conversations under a cross-company attack", () => {
  it("creates the conversation when contact and channel are both the caller's", async () => {
    const { pool, conversations: repository } = crm();

    const result = await repository.findOrCreateConversation(A, 101, 55, 7);

    expect(result).toEqual({
      ok: true,
      created: true,
      conversation: expect.objectContaining({ id: "7100", channel_type: "whatsapp_official" })
    });
    expect(wrote(pool, "conversations")).toBe(true);
  });

  it("refuses a contact that exists only inside another company", async () => {
    const { pool, conversations: repository } = crm();

    const result = await repository.findOrCreateConversation(A, 500, 44, 7);

    expect(result).toEqual({ ok: false, reason: "contact_not_found" });
    expect(sql(pool, "INSERT INTO conversations")).toBeUndefined();
    expectNothingWritten(pool);
  });

  it("refuses a channel that exists only inside another company", async () => {
    const { pool, conversations: repository } = crm();

    const result = await repository.findOrCreateConversation(A, 101, 44, 7);

    expect(result).toEqual({ ok: false, reason: "channel_not_found" });
    expect(sql(pool, "INSERT INTO conversations")).toBeUndefined();
    expectNothingWritten(pool);
  });

  it("never returns a conversation row attributed to another company for our own pair", async () => {
    // La fila 7002 apunta al contacto 101 y al canal 55 —ambos nuestros— pero
    // su `company_id` es de B. Devolverla filtraria un identificador ajeno.
    const { pool, conversations: repository } = crm();

    const result = await repository.findOrCreateConversation(A, 101, 55, 7);

    expect(result.ok && result.conversation.id).not.toBe("7002");
    expect(result.ok && result.created).toBe(true);
    expect(sql(pool, "FROM conversations")!.params).toEqual([101, 55, A]);
  });

  it("answers a foreign contact and an absent contact with the very same reason", async () => {
    const foreign = await crm().conversations.findOrCreateConversation(A, 500, 55, 7);
    const absent = await crm().conversations.findOrCreateConversation(A, 424_242, 55, 7);

    expect(foreign).toEqual(absent);
  });

  it("answers a foreign channel and an absent channel with the very same reason", async () => {
    const foreign = await crm().conversations.findOrCreateConversation(A, 101, 44, 7);
    const absent = await crm().conversations.findOrCreateConversation(A, 101, 424_242, 7);

    expect(foreign).toEqual(absent);
  });

  it("binds the inserted row to the authenticated company, never to the contact's", async () => {
    const { pool, conversations: repository } = crm();

    await repository.findOrCreateConversation(A, 101, 55, 7);

    expect(sql(pool, "INSERT INTO conversations")!.params[0]).toBe(A);
  });

  it("keeps the strict company filter on both validations and on the lookup", async () => {
    const { pool, conversations: repository } = crm();

    await repository.findOrCreateConversation(A, 101, 55, 7);

    expectStrictCompanyFilter(sql(pool, "FROM contacts")!, "$2");
    expectStrictCompanyFilter(sql(pool, "FROM channel_connections")!, "$2");
    expectStrictCompanyFilter(sql(pool, "FROM conversations")!, "$3");
  });
});

/**
 * `PostgresContactMutationRepository` es el modulo de escritura mas antiguo y
 * el unico que no tenia ninguna prueba a nivel de SQL: su aislamiento solo
 * estaba comprobado contra dobles en memoria de la ruta, que no pueden ver el
 * `WHERE`. Estas pruebas cierran ese hueco con el mismo criterio que el resto.
 */
describe("contact, note and tag writes under a cross-company attack", () => {
  it("updates, archives and tags a contact of the caller's own company", async () => {
    const { pool, contacts: repository } = crm();

    expect(await repository.updateContact(A, 101, { name: "Nuevo" })).not.toBeNull();
    expect(await repository.archiveContact(A, 101)).not.toBeNull();
    expect(await repository.attachTag(A, 101, "oro")).not.toBeNull();
    expect(await repository.detachTag(A, 101, "vip")).not.toBeNull();
    expect(await repository.createNote(A, 101, 7, "Nota")).not.toBeNull();
    expect(wrote(pool, "contacts:write")).toBe(true);
    expect(wrote(pool, "notes")).toBe(true);
  });

  it.each([
    ["updateContact", (r: PostgresContactMutationRepository) => r.updateContact(A, 500, { name: "Secuestrado" })],
    ["archiveContact", (r: PostgresContactMutationRepository) => r.archiveContact(A, 500)],
    ["attachTag", (r: PostgresContactMutationRepository) => r.attachTag(A, 500, "intruso")],
    ["detachTag", (r: PostgresContactMutationRepository) => r.detachTag(A, 500, "vip")],
    ["createNote", (r: PostgresContactMutationRepository) => r.createNote(A, 500, 7, "Intruso")]
  ])("refuses %s against a contact of another company", async (_name, run) => {
    const { pool, contacts: repository } = crm();

    expect(await run(repository)).toBeNull();
    expectNothingWritten(pool);
  });

  it("refuses to update a note whose contact belongs to another company", async () => {
    // La nota 900 no tiene `company_id` propio: su empresa solo existe a
    // traves del contacto 500, que es de B.
    const { pool, contacts: repository } = crm();

    expect(await repository.updateNote(A, 900, "Intruso")).toBeNull();
    expectNothingWritten(pool);
  });

  it("refuses to delete a note whose contact belongs to another company", async () => {
    const { pool, contacts: repository } = crm();

    expect(await repository.deleteNote(A, 900)).toBe(false);
    expectNothingWritten(pool);
  });

  it("still reaches a note of the caller's own company through the same join", async () => {
    const { pool, contacts: repository } = crm();

    expect(await repository.updateNote(A, 800, "Corregida")).not.toBeNull();
    expect(await repository.deleteNote(A, 800)).toBe(true);
    expect(wrote(pool, "notes:write")).toBe(true);
  });

  it("scopes every note statement through contacts, the only table carrying the company", async () => {
    const { pool, contacts: repository } = crm();

    await repository.updateNote(A, 800, "Corregida");
    await repository.deleteNote(A, 800);

    for (const fragment of ["UPDATE notes", "DELETE FROM notes"]) {
      const call = sql(pool, fragment)!;
      expect(flat(call.text)).toContain("notes.contact_id = contacts.id");
      expect(flat(call.text)).toContain("contacts.company_id = $2");
      expect(call.text).not.toMatch(/company_id\s+IS\s+NULL/i);
      expect(call.text).not.toMatch(/OR\s+\w*\.?company_id/i);
    }
  });

  it("keeps the strict company filter on every contact statement", async () => {
    const { pool, contacts: repository } = crm();

    await repository.updateContact(A, 101, { name: "Nuevo" });
    await repository.archiveContact(A, 101);
    await repository.attachTag(A, 101, "oro");
    await repository.createNote(A, 101, 7, "Nota");

    expectStrictCompanyFilter(sql(pool, "UPDATE contacts SET")!, "$2");
    const note = sql(pool, "INSERT INTO notes")!;
    expect(flat(note.text)).toContain("contacts.company_id = $2");
    expect(note.text).not.toMatch(/OR\s+\w*\.?company_id/i);
  });

  it("binds a created contact to the authenticated company only", async () => {
    const { pool, contacts: repository } = crm();

    await repository.createContact(A, 7, { name: "Contacto nuevo" });

    const insert = sql(pool, "INSERT INTO contacts")!;
    expect(insert.params[0]).toBe(A);
    expect(insert.params).not.toContain(B);
  });

  it("audits every write against the authenticated company, never the row's owner", async () => {
    const { pool, contacts: repository } = crm();

    await repository.updateContact(A, 101, { name: "Nuevo" });

    for (const entry of pool.inserted.filter((item) => item.table === "audit" || item.table === "outbox")) {
      expect(entry.params[0]).toBe(A);
    }
  });
});
