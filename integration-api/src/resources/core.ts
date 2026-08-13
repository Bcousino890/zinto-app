import type pg from "pg";

import { decodeCursor, encodeCursor } from "../http/pagination.js";

export interface PageQuery {
  cursor: string | null;
  limit: number;
}

export interface ResourcePage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ChannelResource {
  id: string;
  type: string;
  name: string;
  status: string;
  capabilities: string[];
}

export interface ContactResource {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  company: string | null;
  tags: string[];
  source: string | null;
  notes: string | null;
  custom_fields: Record<string, unknown>;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationResource {
  id: string;
  contact_id: string | null;
  channel_id: string;
  channel_type: string;
  status: string;
  assigned_to_user_id: string | null;
  last_message_at: string | null;
  unread_count: number;
  bot_disabled: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageResource {
  id: string;
  conversation_id: string;
  external_id: string | null;
  direction: string;
  type: string;
  content: string;
  status: string;
  sender_id: string | null;
  sender_type: string | null;
  from_bot: boolean;
  media_url: string | null;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface CoreRepository {
  listChannels(companyId: number): Promise<ChannelResource[]>;
  listContacts(companyId: number, query: PageQuery): Promise<ResourcePage<ContactResource>>;
  listConversations(companyId: number, query: PageQuery): Promise<ResourcePage<ConversationResource>>;
  listMessages(
    companyId: number,
    conversationId: number,
    query: PageQuery
  ): Promise<ResourcePage<MessageResource> | null>;
}

export type Timestamp = Date | string | null;

export function iso(value: Timestamp): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function capabilities(channelType: string): string[] {
  switch (channelType) {
    case "whatsapp":
    case "whatsapp_unofficial":
      return ["text", "media"];
    case "whatsapp_official":
      return ["text", "media", "template", "interactive"];
    case "whatsapp_meta":
      return ["text", "media"];
    case "email":
      return ["text", "html", "attachments"];
    case "twilio_voice":
      return ["voice"];
    default:
      return ["text", "media"];
  }
}

export function cursorParameters(query: PageQuery): [string | null, number | null] {
  if (query.cursor === null) return [null, null];
  const cursor = decodeCursor(query.cursor);
  return [cursor.createdAt, Number(cursor.id)];
}

export function paged<T extends { id: string; created_at: string }>(rows: T[], limit: number): ResourcePage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    hasMore,
    nextCursor: hasMore && last !== undefined
      ? encodeCursor({ id: last.id, createdAt: last.created_at })
      : null
  };
}

interface ChannelRow {
  id: number;
  channel_type: string;
  account_name: string;
  status: string | null;
}

interface ContactRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  company: string | null;
  tags: string[] | null;
  source: string | null;
  notes: string | null;
  custom_fields: Record<string, unknown> | null;
  is_archived: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
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

interface MessageRow {
  id: number;
  conversation_id: number;
  external_id: string | null;
  direction: string;
  type: string | null;
  content: string;
  status: string | null;
  sender_id: number | null;
  sender_type: string | null;
  is_from_bot: boolean | null;
  media_url: string | null;
  sent_at: Timestamp;
  read_at: Timestamp;
  created_at: Timestamp;
}

export class PostgresCoreRepository implements CoreRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listChannels(companyId: number): Promise<ChannelResource[]> {
    const result = await this.pool.query<ChannelRow>(
      `SELECT id, channel_type, account_name, status
         FROM channel_connections
        WHERE company_id = $1
        ORDER BY id ASC`,
      [companyId]
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      type: row.channel_type,
      name: row.account_name,
      status: row.status ?? "unknown",
      capabilities: capabilities(row.channel_type)
    }));
  }

  async listContacts(companyId: number, query: PageQuery): Promise<ResourcePage<ContactResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<ContactRow>(
      `SELECT id, name, email, phone, avatar_url, company, tags, source, notes,
              custom_fields, is_archived, created_at, updated_at
         FROM contacts
        WHERE company_id = $1
          AND deleted_at IS NULL
          AND ($2::timestamp IS NULL OR (created_at, id) < ($2::timestamp, $3::integer))
        ORDER BY created_at DESC, id DESC
        LIMIT $4`,
      [companyId, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      email: row.email,
      phone: row.phone,
      avatar_url: row.avatar_url,
      company: row.company,
      tags: row.tags ?? [],
      source: row.source,
      notes: row.notes,
      custom_fields: row.custom_fields ?? {},
      archived: row.is_archived,
      created_at: iso(row.created_at)!,
      updated_at: iso(row.updated_at)!
    })), query.limit);
  }

  async listConversations(companyId: number, query: PageQuery): Promise<ResourcePage<ConversationResource>> {
    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<ConversationRow>(
      `SELECT id, contact_id, channel_id, channel_type, status, assigned_to_user_id,
              last_message_at, unread_count, bot_disabled, is_archived, created_at, updated_at
         FROM conversations
        WHERE company_id = $1
          AND ($2::timestamp IS NULL OR (created_at, id) < ($2::timestamp, $3::integer))
        ORDER BY created_at DESC, id DESC
        LIMIT $4`,
      [companyId, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map((row) => ({
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
    })), query.limit);
  }

  async listMessages(
    companyId: number,
    conversationId: number,
    query: PageQuery
  ): Promise<ResourcePage<MessageResource> | null> {
    const conversation = await this.pool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM conversations WHERE id = $1 AND company_id = $2) AS exists",
      [conversationId, companyId]
    );
    if (conversation.rows[0]?.exists !== true) return null;

    const [cursorDate, cursorId] = cursorParameters(query);
    const result = await this.pool.query<MessageRow>(
      `SELECT messages.id, messages.conversation_id, messages.external_id, messages.direction,
              messages.type, messages.content, messages.status, messages.sender_id,
              messages.sender_type, messages.is_from_bot, messages.media_url, messages.sent_at,
              messages.read_at, messages.created_at
         FROM messages
         JOIN conversations ON conversations.id = messages.conversation_id
        WHERE messages.conversation_id = $1
          AND conversations.company_id = $2
          AND ($3::timestamp IS NULL OR (messages.created_at, messages.id) < ($3::timestamp, $4::integer))
        ORDER BY messages.created_at DESC, messages.id DESC
        LIMIT $5`,
      [conversationId, companyId, cursorDate, cursorId, query.limit + 1]
    );
    return paged(result.rows.map((row) => ({
      id: String(row.id),
      conversation_id: String(row.conversation_id),
      external_id: row.external_id,
      direction: row.direction,
      type: row.type ?? "text",
      content: row.content,
      status: row.status ?? "sent",
      sender_id: row.sender_id === null ? null : String(row.sender_id),
      sender_type: row.sender_type,
      from_bot: row.is_from_bot ?? false,
      media_url: row.media_url,
      sent_at: iso(row.sent_at),
      read_at: iso(row.read_at),
      created_at: iso(row.created_at)!
    })), query.limit);
  }
}
