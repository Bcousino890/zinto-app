import type pg from "pg";

/**
 * Our own record of who sent a message through this API.
 *
 * This does not, and cannot, fix `messages.sender_id` in the legacy CRM: that
 * value is written by the compiled delivery engine itself (see
 * docs/api/LEGACY-ENGINE-AUDIT-2026-08-13.md, "PREGUNTA 1") and is out of
 * reach from this codebase. What this repository closes is a narrower gap -
 * our own audit trail knowing the real actor, even while the CRM UI does not.
 */
export interface DeliveryAuditEntry {
  companyId: number;
  actorUserId: number;
  action: string;
  resourceType: string;
  resourceId: string | null;
  payload: unknown;
}

export interface DeliveryAuditRepository {
  record(entry: DeliveryAuditEntry): Promise<void>;
}

function numericResourceId(resourceId: string | null): number | null {
  return resourceId !== null && /^\d+$/.test(resourceId) ? Number(resourceId) : null;
}

export class PostgresDeliveryAuditRepository implements DeliveryAuditRepository {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Deliberately a single statement, not a transaction: by the time this
   * runs, `delivery.deliver()` has already resolved successfully, so there is
   * no write of our own to wrap it around. Callers treat this as best-effort
   * (see `performDelivery` in src/routes/message-send.ts) - a failure here
   * must never turn an already-successful send into a failed response.
   */
  async record(entry: DeliveryAuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO integration_api_audit_records
         (company_id, actor_user_id, action, resource_type, resource_id, new_values)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        entry.companyId,
        entry.actorUserId,
        entry.action,
        entry.resourceType,
        numericResourceId(entry.resourceId),
        JSON.stringify(entry.payload)
      ]
    );
  }
}
