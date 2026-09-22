import type { Sql, TransactionSql } from "postgres";
export type DatabaseSql = Sql | TransactionSql;
export interface Posting { code: string; name: string; type: "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE" | "EQUITY"; sellerId?: string; debit: bigint; credit: bigint; }
export async function postJournal(sql: DatabaseSql, referenceType: string, referenceId: string, description: string, currency: string, entries: readonly Posting[]) {
  const normalized = entries.filter(e => e.debit !== 0n || e.credit !== 0n).map(e => ({ ...e, code: `${e.code}_${currency}`, debit: e.debit.toString(), credit: e.credit.toString() }));
  if (!normalized.length) return null; // Free orders have no money movement.
  const payload = JSON.stringify(normalized);
  const [result] = await sql`SELECT cc_post_journal(${referenceType}, ${referenceId}, ${description}, ${currency}, ${payload}::jsonb) AS id`;
  return result?.id as string | undefined;
}
export async function enqueue(sql: DatabaseSql, type: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown>, dedupeKey: string) {
  await sql`INSERT INTO outbox_event (event_type,aggregate_type,aggregate_id,payload,dedupe_key)
    VALUES (${type},${aggregateType},${aggregateId},${JSON.stringify(payload)}::jsonb,${dedupeKey}) ON CONFLICT (dedupe_key) DO NOTHING`;
}
export interface AuditRecord { actorType?: "USER"|"ADMIN"|"SYSTEM"|"WEBHOOK"; actorUserId?: string | null; action: string; resourceType: string; resourceId: string; before?: unknown; after?: unknown; reason: string; }
export function audit(sql: DatabaseSql, record: AuditRecord): Promise<void>;
export function audit(sql: DatabaseSql, userId: string | null, action: string, type: string, id: string, before: unknown, after: unknown, reason: string): Promise<void>;
export async function audit(sql: DatabaseSql, recordOrUser: AuditRecord | string | null, action?: string, type?: string, id?: string, before?: unknown, after?: unknown, reason?: string): Promise<void> {
  const r:AuditRecord = typeof recordOrUser === "object" && recordOrUser !== null ? recordOrUser : {
    actorUserId: recordOrUser, action: action!, resourceType: type!, resourceId: id!, before, after, reason: reason!,
  };
  await sql`INSERT INTO audit_event (actor_user_id,actor_type,action,resource_type,resource_id,"before","after",metadata)
    VALUES (${r.actorUserId ?? null},${r.actorType??(r.actorUserId ? "ADMIN" : "SYSTEM")},${r.action},${r.resourceType},${r.resourceId},${JSON.stringify(r.before ?? null)}::jsonb,${JSON.stringify(r.after ?? null)}::jsonb,${JSON.stringify({ reason:r.reason })}::jsonb)`;
}
