import type pg from "pg";

import type { ContactResource } from "./core.js";

export interface ContactMutationInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  company?: string | null;
  tags?: string[];
  source?: string | null;
  notes?: string | null;
  custom_fields?: Record<string, unknown>;
}

export type ContactMutationResource = ContactResource;

export interface NoteMutationResource {
  id: string;
  contact_id: string;
  created_by_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ContactMutationRepository {
  createContact(companyId: number, userId: number, input: ContactMutationInput): Promise<ContactMutationResource>;
  updateContact(
    companyId: number,
    contactId: number,
    input: Partial<ContactMutationInput>
  ): Promise<ContactMutationResource | null>;
  archiveContact(companyId: number, contactId: number): Promise<ContactMutationResource | null>;
  createNote(
    companyId: number,
    contactId: number,
    userId: number,
    content: string
  ): Promise<NoteMutationResource | null>;
  updateNote(companyId: number, noteId: number, content: string): Promise<NoteMutationResource | null>;
  deleteNote(companyId: number, noteId: number): Promise<boolean>;
  attachTag(companyId: number, contactId: number, tag: string): Promise<ContactMutationResource | null>;
  detachTag(companyId: number, contactId: number, tag: string): Promise<ContactMutationResource | null>;
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
  created_at: Date;
  updated_at: Date;
}

interface NoteRow {
  id: number;
  contact_id: number;
  created_by_id: number;
  content: string;
  created_at: Date;
  updated_at: Date;
}

function contact(row: ContactRow): ContactMutationResource {
  return {
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
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  };
}

function note(row: NoteRow): NoteMutationResource {
  return {
    id: String(row.id),
    contact_id: String(row.contact_id),
    created_by_id: String(row.created_by_id),
    content: row.content,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  };
}

const contactColumns = `id, name, email, phone, avatar_url, company, tags, source, notes,
  custom_fields, is_archived, created_at, updated_at`;

export class PostgresContactMutationRepository implements ContactMutationRepository {
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

  async createContact(companyId: number, userId: number, input: ContactMutationInput) {
    return this.transaction(async (client) => {
      const result = await client.query<ContactRow>(
        `INSERT INTO contacts
           (company_id, name, email, phone, avatar_url, company, tags, source, notes,
            custom_fields, created_by, identifier, identifier_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'api'), $9, $10::jsonb, $11,
                 COALESCE($4, $3), CASE WHEN $4 IS NULL THEN 'email' ELSE 'phone' END)
         RETURNING ${contactColumns}`,
        [
          companyId, input.name, input.email ?? null, input.phone ?? null,
          input.avatar_url ?? null, input.company ?? null, input.tags ?? [], input.source ?? null,
          input.notes ?? null, JSON.stringify(input.custom_fields ?? {}), userId
        ]
      );
      const resource = contact(result.rows[0]!);
      await this.record(client, companyId, userId, "contact.created", "contact", Number(resource.id), resource);
      return resource;
    });
  }

  async updateContact(companyId: number, contactId: number, input: Partial<ContactMutationInput>) {
    return this.transaction(async (client) => {
      const result = await client.query<ContactRow>(
        `UPDATE contacts SET
           name = COALESCE($3, name), email = CASE WHEN $4 THEN $5 ELSE email END,
           phone = CASE WHEN $6 THEN $7 ELSE phone END,
           avatar_url = CASE WHEN $8 THEN $9 ELSE avatar_url END,
           company = CASE WHEN $10 THEN $11 ELSE company END,
           tags = CASE WHEN $12 THEN $13 ELSE tags END,
           source = CASE WHEN $14 THEN $15 ELSE source END,
           notes = CASE WHEN $16 THEN $17 ELSE notes END,
           custom_fields = CASE WHEN $18 THEN $19::jsonb ELSE custom_fields END,
           updated_at = NOW()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
         RETURNING ${contactColumns}`,
        [
          contactId, companyId, input.name ?? null,
          "email" in input, input.email ?? null, "phone" in input, input.phone ?? null,
          "avatar_url" in input, input.avatar_url ?? null, "company" in input, input.company ?? null,
          "tags" in input, input.tags ?? [], "source" in input, input.source ?? null,
          "notes" in input, input.notes ?? null, "custom_fields" in input,
          JSON.stringify(input.custom_fields ?? {})
        ]
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const resource = contact(row);
      await this.record(client, companyId, null, "contact.updated", "contact", contactId, resource);
      return resource;
    });
  }

  async archiveContact(companyId: number, contactId: number) {
    return this.transaction(async (client) => {
      const result = await client.query<ContactRow>(
        `UPDATE contacts SET is_archived = TRUE, updated_at = NOW()
          WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
          RETURNING ${contactColumns}`,
        [contactId, companyId]
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const resource = contact(row);
      await this.record(client, companyId, null, "contact.deleted", "contact", contactId, resource);
      return resource;
    });
  }

  async createNote(companyId: number, contactId: number, userId: number, content: string) {
    return this.transaction(async (client) => {
      const result = await client.query<NoteRow>(
        `INSERT INTO notes (contact_id, created_by_id, content)
         SELECT contacts.id, $3, $4 FROM contacts
          WHERE contacts.id = $1 AND contacts.company_id = $2 AND contacts.deleted_at IS NULL
         RETURNING id, contact_id, created_by_id, content, created_at, updated_at`,
        [contactId, companyId, userId, content]
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const resource = note(row);
      await this.record(client, companyId, userId, "note.created", "note", row.id, resource);
      return resource;
    });
  }

  async updateNote(companyId: number, noteId: number, content: string) {
    return this.transaction(async (client) => {
      const result = await client.query<NoteRow>(
        `UPDATE notes SET content = $3, updated_at = NOW()
          FROM contacts
         WHERE notes.id = $1 AND notes.contact_id = contacts.id AND contacts.company_id = $2
         RETURNING notes.id, notes.contact_id, notes.created_by_id, notes.content,
                   notes.created_at, notes.updated_at`,
        [noteId, companyId, content]
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const resource = note(row);
      await this.record(client, companyId, null, "note.updated", "note", noteId, resource);
      return resource;
    });
  }

  async deleteNote(companyId: number, noteId: number): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query<{ id: number }>(
        `DELETE FROM notes USING contacts
          WHERE notes.id = $1 AND notes.contact_id = contacts.id AND contacts.company_id = $2
          RETURNING notes.id`,
        [noteId, companyId]
      );
      if (result.rows[0] === undefined) return false;
      await this.record(client, companyId, null, "note.deleted", "note", noteId, { id: String(noteId) });
      return true;
    });
  }

  async attachTag(companyId: number, contactId: number, tag: string) {
    return this.changeTag(companyId, contactId, tag, true);
  }

  async detachTag(companyId: number, contactId: number, tag: string) {
    return this.changeTag(companyId, contactId, tag, false);
  }

  private async changeTag(companyId: number, contactId: number, tag: string, attach: boolean) {
    return this.transaction(async (client) => {
      const result = await client.query<ContactRow>(
        attach
          ? `UPDATE contacts SET tags = CASE
                 WHEN $3 = ANY(COALESCE(tags, '{}')) THEN COALESCE(tags, '{}')
                 ELSE COALESCE(tags, '{}') || ARRAY[$3]::text[]
               END, updated_at = NOW()
               WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL RETURNING ${contactColumns}`
          : `UPDATE contacts SET tags = array_remove(COALESCE(tags, '{}'), $3), updated_at = NOW()
               WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL RETURNING ${contactColumns}`,
        [contactId, companyId, tag]
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const resource = contact(row);
      await this.record(
        client,
        companyId,
        null,
        attach ? "tag.attached" : "tag.detached",
        "contact",
        contactId,
        { contact_id: String(contactId), tag }
      );
      return resource;
    });
  }
}
