import type pg from "pg";
import { describe, expect, it } from "vitest";

import { PostgresConversationMutationRepository } from "../src/resources/conversation-mutations.js";

interface Call {
  text: string;
  params: unknown[];
}

interface Rows {
  rows: unknown[];
}

/**
 * Mismo doble que `pipeline-mutation-repository.test.ts`: el repositorio toma un
 * cliente del pool para abrir transaccion, asi que expone `connect()` ademas de
 * `query()`.
 */
class FakePool {
  calls: Call[] = [];
  releases = 0;

  constructor(private readonly responder: (text: string) => Rows) {}

  async connect(): Promise<pg.PoolClient> {
    const client = {
      query: async (text: string, params: unknown[] = []): Promise<Rows> => {
        this.calls.push({ text, params });
        return this.responder(text);
      },
      release: (): void => {
        this.releases += 1;
      }
    };
    return client as unknown as pg.PoolClient;
  }
}

const contact = { id: 101 };
const channel = { id: 55, channel_type: "whatsapp_official" };
const conversation = {
  id: 7001,
  contact_id: 101,
  channel_id: 55,
  channel_type: "whatsapp_official",
  status: "open",
  assigned_to_user_id: null,
  last_message_at: new Date("2026-08-13T10:00:00.000Z"),
  unread_count: 0,
  bot_disabled: false,
  is_archived: false,
  created_at: new Date("2026-08-13T10:00:00.000Z"),
  updated_at: new Date("2026-08-13T10:00:00.000Z")
};

interface Fixtures {
  contact?: unknown;
  channel?: unknown;
  existing?: unknown;
  inserted?: unknown;
  failOnInsert?: boolean;
}

function repository(fixtures: Fixtures = {}) {
  const rows = (value: unknown): Rows => ({ rows: value === undefined ? [] : [value] });
  const pool = new FakePool((text) => {
    if (text.includes("INSERT INTO conversations")) {
      if (fixtures.failOnInsert === true) throw new Error("deadlock detected");
      return rows(fixtures.inserted);
    }
    if (text.includes("FROM conversations")) return rows(fixtures.existing);
    if (text.includes("FROM contacts")) return rows(fixtures.contact);
    if (text.includes("FROM channel_connections")) return rows(fixtures.channel);
    return { rows: [] };
  });
  return {
    pool,
    resources: new PostgresConversationMutationRepository(pool as unknown as pg.Pool)
  };
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const find = (pool: FakePool, fragment: string) =>
  pool.calls.find((call) => call.text.includes(fragment));
const texts = (pool: FakePool) => pool.calls.map((call) => flat(call.text));
const indexOfCall = (pool: FakePool, fragment: string) =>
  pool.calls.findIndex((call) => call.text.includes(fragment));

function expectStrictCompanyFilter(call: Call, placeholder: string): void {
  expect(flat(call.text)).toContain(`company_id = ${placeholder}`);
  expect(call.text).not.toMatch(/company_id\s+IS\s+NULL/i);
  expect(call.text).not.toMatch(/OR\s+\w*\.?company_id/i);
}

describe("conversation find-or-create repository", () => {
  it("takes the advisory lock as the first statement of the transaction", async () => {
    const { pool, resources } = repository({ contact, channel, inserted: conversation });

    await resources.findOrCreateConversation(12, 101, 55, 7);

    // `conversations` no tiene restriccion UNIQUE sobre (contact_id,
    // channel_id), asi que el lock es lo unico que impide el duplicado: si deja
    // de ser la primera sentencia, la carrera vuelve.
    expect(texts(pool)[0]).toBe("BEGIN");
    expect(texts(pool)[1]).toBe("SELECT set_config('zinto.integration_api_origin', 'api', true)");
    expect(texts(pool)[2]).toBe("SELECT pg_advisory_xact_lock(hashtext($1))");
    expect(texts(pool).at(-1)).toBe("COMMIT");
    expect(pool.releases).toBe(1);
  });

  it("derives the lock key from the contact and the channel of this request", async () => {
    const { pool, resources } = repository({ contact, channel, inserted: conversation });

    await resources.findOrCreateConversation(12, 101, 55, 7);

    const lock = find(pool, "pg_advisory_xact_lock")!;
    expect(lock.params).toEqual(["101:55"]);
  });

  it("never reads or writes conversations before holding the lock", async () => {
    const { pool, resources } = repository({ contact, channel, inserted: conversation });

    await resources.findOrCreateConversation(12, 101, 55, 7);

    const lock = indexOfCall(pool, "pg_advisory_xact_lock");
    expect(lock).toBeGreaterThanOrEqual(0);
    const touchingConversations = pool.calls
      .map((call, index) => ({ index, text: call.text }))
      .filter((call) => /\bconversations\b/.test(call.text));
    expect(touchingConversations.length).toBeGreaterThan(0);
    for (const call of touchingConversations) {
      expect(call.index).toBeGreaterThan(lock);
    }
  });

  it("distinguishes id pairs that would collide without a separator", async () => {
    const first = repository({ contact, channel, inserted: conversation });
    await first.resources.findOrCreateConversation(12, 1, 23, 7);
    const second = repository({ contact, channel, inserted: conversation });
    await second.resources.findOrCreateConversation(12, 12, 3, 7);

    expect(find(first.pool, "pg_advisory_xact_lock")!.params).toEqual(["1:23"]);
    expect(find(second.pool, "pg_advisory_xact_lock")!.params).toEqual(["12:3"]);
  });

  it("returns the existing conversation without inserting or auditing anything", async () => {
    const { pool, resources } = repository({ contact, channel, existing: conversation });

    const result = await resources.findOrCreateConversation(12, 101, 55, 7);

    expect(result).toEqual({
      ok: true,
      created: false,
      conversation: expect.objectContaining({ id: "7001" })
    });
    expect(find(pool, "INSERT INTO conversations")).toBeUndefined();
    expect(find(pool, "integration_api_audit_records")).toBeUndefined();
    expect(find(pool, "integration_api_outbox")).toBeUndefined();
    expect(texts(pool)).not.toContain("ROLLBACK");
  });

  it("looks the pair up scoped to the company and with a deterministic order", async () => {
    const { pool, resources } = repository({ contact, channel, existing: conversation });

    await resources.findOrCreateConversation(12, 101, 55, 7);

    const lookup = find(pool, "FROM conversations")!;
    expectStrictCompanyFilter(lookup, "$3");
    expect(flat(lookup.text)).toContain("WHERE contact_id = $1 AND channel_id = $2");
    // Sin restriccion unica la tabla puede tener duplicados heredados del motor
    // legacy: un LIMIT 1 sin orden devolveria una u otra fila segun el plan.
    expect(flat(lookup.text)).toContain("ORDER BY id ASC");
    expect(flat(lookup.text)).toContain("LIMIT 1");
    expect(lookup.params).toEqual([101, 55, 12]);
  });

  it("creates the conversation and records audit and outbox in the same transaction", async () => {
    const { pool, resources } = repository({ contact, channel, inserted: conversation });

    const result = await resources.findOrCreateConversation(12, 101, 55, 7);

    expect(result).toEqual({
      ok: true,
      created: true,
      conversation: expect.objectContaining({ id: "7001" })
    });
    const audit = find(pool, "integration_api_audit_records")!;
    expect(audit.params.slice(0, 5)).toEqual([12, 7, "conversation.created", "conversation", 7001]);
    const outbox = find(pool, "integration_api_outbox")!;
    expect(outbox.params.slice(0, 4)).toEqual([12, "conversation.created", "conversation", 7001]);
    expect(JSON.parse(outbox.params[4] as string)).toEqual(
      result.ok ? result.conversation : undefined
    );
    expect(texts(pool).indexOf("COMMIT")).toBeGreaterThan(indexOfCall(pool, "integration_api_outbox"));
  });

  it("takes channel_type from the channel row, never from the caller", async () => {
    const { pool, resources } = repository({
      contact,
      channel: { id: 55, channel_type: "email" },
      inserted: { ...conversation, channel_type: "email" }
    });

    const result = await resources.findOrCreateConversation(12, 101, 55, 7);

    const channelRead = find(pool, "FROM channel_connections")!;
    expect(flat(channelRead.text)).toContain("SELECT id, channel_type");
    expectStrictCompanyFilter(channelRead, "$2");
    expect(channelRead.params).toEqual([55, 12]);
    // El canal se lee dentro de la misma transaccion que hace el INSERT.
    expect(indexOfCall(pool, "FROM channel_connections"))
      .toBeLessThan(indexOfCall(pool, "INSERT INTO conversations"));

    const insert = find(pool, "INSERT INTO conversations")!;
    expect(insert.params).toEqual([12, 101, 55, "email"]);
    expect(result.ok && result.conversation.channel_type).toBe("email");
  });

  it("inserts a one-to-one row that satisfies check_conversation_type", async () => {
    const { pool, resources } = repository({ contact, channel, inserted: conversation });

    await resources.findOrCreateConversation(12, 101, 55, 7);

    const insert = find(pool, "INSERT INTO conversations")!;
    const sql = flat(insert.text);
    // La rama 1:1 del CHECK exige is_group = false, contact_id NOT NULL y
    // group_jid NULL. Se cumple dejando que las tres tomen su DEFAULT y
    // pasando el contacto real: escribir cualquiera de ellas aqui solo podria
    // romperlo.
    expect(sql).toContain("(company_id, contact_id, channel_id, channel_type)");
    expect(sql).not.toMatch(/is_group/i);
    expect(sql).not.toMatch(/group_jid/i);
    expect(insert.params[1]).toBe(101);
    expect(insert.params[1]).not.toBeNull();
  });

  it("writes nothing when the contact belongs to another company", async () => {
    const { pool, resources } = repository({ channel, inserted: conversation });

    const result = await resources.findOrCreateConversation(12, 900, 55, 7);

    expect(result).toEqual({ ok: false, reason: "contact_not_found" });
    const contactRead = find(pool, "FROM contacts")!;
    expectStrictCompanyFilter(contactRead, "$2");
    expect(flat(contactRead.text)).toContain("deleted_at IS NULL");
    expect(contactRead.params).toEqual([900, 12]);
    expect(find(pool, "FROM conversations")).toBeUndefined();
    expect(find(pool, "INSERT INTO conversations")).toBeUndefined();
    expect(find(pool, "integration_api_outbox")).toBeUndefined();
  });

  it("writes nothing when the channel belongs to another company", async () => {
    const { pool, resources } = repository({ contact, inserted: conversation });

    const result = await resources.findOrCreateConversation(12, 101, 999, 7);

    expect(result).toEqual({ ok: false, reason: "channel_not_found" });
    expect(find(pool, "FROM conversations")).toBeUndefined();
    expect(find(pool, "INSERT INTO conversations")).toBeUndefined();
    expect(find(pool, "integration_api_outbox")).toBeUndefined();
  });

  it("returns the same resource shape the conversation list returns", async () => {
    const { resources } = repository({ contact, channel, inserted: conversation });

    const result = await resources.findOrCreateConversation(12, 101, 55, 7);

    expect(result.ok && result.conversation).toEqual({
      id: "7001",
      contact_id: "101",
      channel_id: "55",
      channel_type: "whatsapp_official",
      status: "open",
      assigned_to_user_id: null,
      last_message_at: "2026-08-13T10:00:00.000Z",
      unread_count: 0,
      bot_disabled: false,
      archived: false,
      created_at: "2026-08-13T10:00:00.000Z",
      updated_at: "2026-08-13T10:00:00.000Z"
    });
  });

  it("rolls back and releases the client when the insert fails", async () => {
    const { pool, resources } = repository({ contact, channel, failOnInsert: true });

    await expect(resources.findOrCreateConversation(12, 101, 55, 7))
      .rejects.toThrow("deadlock detected");
    // El ROLLBACK es tambien lo que suelta el advisory lock: sin el, la segunda
    // peticion en cola se quedaria esperando hasta cerrar la conexion.
    expect(texts(pool)).toContain("ROLLBACK");
    expect(texts(pool)).not.toContain("COMMIT");
    expect(pool.releases).toBe(1);
  });
});
