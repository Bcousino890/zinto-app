import type pg from "pg";
import { describe, expect, it } from "vitest";

import { encodeCursor } from "../src/http/pagination.js";
import { PostgresCoreRepository } from "../src/resources/core.js";

interface Call {
  text: string;
  params: unknown[];
}

class FakePool {
  calls: Call[] = [];

  constructor(private readonly responses: Array<{ rows: unknown[] }> = []) {}

  async query(text: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    this.calls.push({ text, params });
    return this.responses[this.calls.length - 1] ?? { rows: [] };
  }
}

function repository(responses: Array<{ rows: unknown[] }> = []) {
  const pool = new FakePool(responses);
  return { pool, resources: new PostgresCoreRepository(pool as unknown as pg.Pool) };
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const page = { cursor: null, limit: 50, updatedSince: null };

describe("core read repository", () => {
  it("finds one contact only inside its company", async () => {
    const { pool, resources } = repository([{ rows: [{
      id: 103,
      name: "Contacto tres",
      email: null,
      phone: "+34600000103",
      avatar_url: null,
      company: null,
      tags: null,
      source: "whatsapp",
      notes: null,
      custom_fields: null,
      is_archived: false,
      created_at: new Date("2026-08-13T10:00:00.000Z"),
      updated_at: new Date("2026-08-13T10:00:00.000Z")
    }] }]);

    const result = await resources.findContact(12, 103);

    expect(pool.calls[0]!.params).toEqual([103, 12]);
    expect(pool.calls[0]!.text).toContain("company_id = $2");
    expect(result?.id).toBe("103");
  });

  it("lists notes through contacts so note IDs cannot cross tenants", async () => {
    const { pool, resources } = repository([{ rows: [{ exists: true }] }, { rows: [{
      id: 44,
      contact_id: 103,
      created_by_id: 4,
      content: "Seguimiento",
      created_at: new Date("2026-08-13T10:00:00.000Z"),
      updated_at: new Date("2026-08-13T10:00:00.000Z")
    }] }]);

    const result = await resources.listNotes(12, 103, { ...page, updatedSince: "2026-08-12T00:00:00.000Z" });

    expect(pool.calls[0]!.params).toEqual([103, 12]);
    expect(pool.calls[1]!.params).toEqual([103, 12, "2026-08-12T00:00:00.000Z", null, null, 51]);
    expect(pool.calls[1]!.text).toContain("notes.contact_id = $1");
    expect(pool.calls[1]!.text).toContain("contacts.company_id = $2");
    expect(pool.calls[1]!.text).toContain("contacts.deleted_at IS NULL");
    expect(pool.calls[1]!.text).toContain("notes.updated_at >= $3::timestamp");
    expect(result?.items[0]).toMatchObject({ id: "44", contact_id: "103", content: "Seguimiento" });
  });

  it("filters contacts strictly by company and asks for one extra row", async () => {
    const { pool, resources } = repository([{
      rows: [{
        id: 103,
        name: "Contacto tres",
        email: null,
        phone: "+34600000103",
        avatar_url: null,
        company: null,
        tags: null,
        source: "whatsapp",
        notes: null,
        custom_fields: null,
        is_archived: false,
        created_at: new Date("2026-08-13T10:00:00.000Z"),
        updated_at: new Date("2026-08-13T10:00:00.000Z")
      }]
    }]);

    const result = await resources.listContacts(12, { ...page, limit: 2 });

    expect(pool.calls).toHaveLength(1);
    expect(flat(pool.calls[0]!.text)).toContain("company_id = $1");
    expect(flat(pool.calls[0]!.text)).toContain("deleted_at IS NULL");
    expect(pool.calls[0]!.params).toEqual([12, null, null, null, 3]);
    expect(flat(pool.calls[0]!.text)).toContain("ORDER BY created_at DESC, id DESC");
    expect(result.items[0]).toEqual({
      id: "103",
      name: "Contacto tres",
      email: null,
      phone: "+34600000103",
      avatar_url: null,
      company: null,
      tags: [],
      source: "whatsapp",
      notes: null,
      custom_fields: {},
      archived: false,
      created_at: "2026-08-13T10:00:00.000Z",
      updated_at: "2026-08-13T10:00:00.000Z"
    });
    expect(result.hasMore).toBe(false);
  });

  it("passes contacts' updated_since and the decoded cursor as bound parameters, without altering the cursor filter", async () => {
    const { pool, resources } = repository();
    const cursor = encodeCursor({ id: "103", createdAt: "2026-08-13T10:00:00.000Z" });

    await resources.listContacts(12, {
      cursor,
      limit: 10,
      updatedSince: "2026-08-12T00:00:00.000Z"
    });

    expect(pool.calls[0]!.params).toEqual([
      12,
      "2026-08-12T00:00:00.000Z",
      "2026-08-13T10:00:00.000Z",
      103,
      11
    ]);
    const sql = flat(pool.calls[0]!.text);
    expect(sql).toContain("updated_at >= $2::timestamp");
    expect(sql).toContain("(created_at, id) < ($3::timestamp, $4::integer)");
  });

  it("omits the updated_since filter entirely when absent, exactly like today", async () => {
    const { pool, resources } = repository();

    await resources.listContacts(12, page);

    expect(pool.calls[0]!.params).toEqual([12, null, null, null, 51]);
  });

  it("filters conversations strictly by company and applies updated_since independently of the cursor", async () => {
    const { pool, resources } = repository([{
      rows: [{
        id: 501,
        contact_id: 101,
        channel_id: 22,
        channel_type: "whatsapp",
        status: "open",
        assigned_to_user_id: null,
        last_message_at: new Date("2026-08-13T12:00:00.000Z"),
        unread_count: 0,
        bot_disabled: false,
        is_archived: false,
        created_at: new Date("2026-08-11T12:00:00.000Z"),
        updated_at: new Date("2026-08-13T12:00:00.000Z")
      }]
    }]);

    const result = await resources.listConversations(12, {
      ...page,
      updatedSince: "2026-08-12T00:00:00.000Z"
    });

    expect(flat(pool.calls[0]!.text)).toContain("company_id = $1");
    expect(pool.calls[0]!.params).toEqual([12, "2026-08-12T00:00:00.000Z", null, null, 51]);
    expect(result.items[0]).toEqual({
      id: "501",
      contact_id: "101",
      channel_id: "22",
      channel_type: "whatsapp",
      status: "open",
      assigned_to_user_id: null,
      last_message_at: "2026-08-13T12:00:00.000Z",
      unread_count: 0,
      bot_disabled: false,
      archived: false,
      created_at: "2026-08-11T12:00:00.000Z",
      updated_at: "2026-08-13T12:00:00.000Z"
    });
  });

  it("never lists messages of a conversation the company does not own", async () => {
    const { pool, resources } = repository([{ rows: [{ exists: false }] }]);

    const result = await resources.listMessages(12, 700, page);

    expect(result).toBeNull();
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]!.params).toEqual([700, 12]);
  });

  it("scopes messages to the conversation and to the company, with updated_since apart from the cursor", async () => {
    const { pool, resources } = repository([
      { rows: [{ exists: true }] },
      {
        rows: [{
          id: 701,
          conversation_id: 501,
          external_id: "wamid.old",
          direction: "outgoing",
          type: "text",
          content: "Mensaje de hace dos dias",
          status: "delivered",
          sender_id: 4,
          sender_type: "user",
          is_from_bot: false,
          media_url: null,
          sent_at: new Date("2026-08-11T12:00:00.000Z"),
          read_at: new Date("2026-08-11T12:01:00.000Z"),
          created_at: new Date("2026-08-11T12:00:00.000Z")
        }]
      }
    ]);

    const result = await resources.listMessages(12, 501, {
      ...page,
      updatedSince: "2026-08-11T00:00:00.000Z"
    });

    expect(pool.calls).toHaveLength(2);
    const sql = flat(pool.calls[1]!.text);
    expect(sql).toContain("messages.conversation_id = $1");
    expect(sql).toContain("conversations.company_id = $2");
    // messages has no updated_at column in the real schema (verified
    // read-only, see docs/api/SCHEMA-VERIFICATION-2026-08-13-02.md); the
    // filter is answered against created_at instead.
    expect(sql).toContain("messages.created_at >= $3::timestamp");
    expect(sql).toContain("(messages.created_at, messages.id) < ($4::timestamp, $5::integer)");
    expect(pool.calls[1]!.params).toEqual([501, 12, "2026-08-11T00:00:00.000Z", null, null, 51]);
    expect(result?.items[0]).toEqual({
      id: "701",
      conversation_id: "501",
      external_id: "wamid.old",
      direction: "outgoing",
      type: "text",
      content: "Mensaje de hace dos dias",
      status: "delivered",
      sender_id: "4",
      sender_type: "user",
      from_bot: false,
      media_url: null,
      sent_at: "2026-08-11T12:00:00.000Z",
      read_at: "2026-08-11T12:01:00.000Z",
      created_at: "2026-08-11T12:00:00.000Z"
    });
  });

  it("finds a single message only through its own company's conversation", async () => {
    const { pool, resources } = repository([{
      rows: [{
        id: 701,
        conversation_id: 501,
        external_id: "wamid.old",
        direction: "outgoing",
        type: "text",
        content: "Mensaje de hace dos dias",
        status: "delivered",
        sender_id: 4,
        sender_type: "user",
        is_from_bot: false,
        media_url: null,
        sent_at: new Date("2026-08-11T12:00:00.000Z"),
        read_at: new Date("2026-08-11T12:01:00.000Z"),
        created_at: new Date("2026-08-11T12:00:00.000Z")
      }]
    }]);

    const result = await resources.findMessage(12, 701);

    expect(pool.calls).toHaveLength(1);
    const sql = flat(pool.calls[0]!.text);
    expect(sql).toContain("messages.id = $1");
    expect(sql).toContain("conversations.company_id = $2");
    expect(pool.calls[0]!.params).toEqual([701, 12]);
    expect(result?.id).toBe("701");
  });

  it("returns null for a message outside the company", async () => {
    const { pool, resources } = repository([{ rows: [] }]);

    expect(await resources.findMessage(12, 999)).toBeNull();
    expect(pool.calls[0]!.params).toEqual([999, 12]);
  });

  it("reports another page of contacts when the extra row comes back", async () => {
    const rows = Array.from({ length: 3 }, (_value, index) => ({
      id: 100 + index,
      name: `Contacto ${index}`,
      email: null,
      phone: null,
      avatar_url: null,
      company: null,
      tags: [],
      source: null,
      notes: null,
      custom_fields: null,
      is_archived: false,
      created_at: new Date(`2026-08-1${index + 1}T08:00:00.000Z`),
      updated_at: new Date(`2026-08-1${index + 1}T08:00:00.000Z`)
    }));
    const { resources } = repository([{ rows }]);

    const result = await resources.listContacts(12, { ...page, limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(encodeCursor({ id: "101", createdAt: "2026-08-12T08:00:00.000Z" }));
  });
});
