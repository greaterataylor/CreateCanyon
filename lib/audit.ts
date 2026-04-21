import { prisma } from './prisma'

export async function createAuditLog(input: { actorUserId?: string | null; siteId?: string | null; entityType: string; entityId: string; action: string; details?: unknown }) {
  try {
    await prisma.auditLog.create({ data: { actorUserId: input.actorUserId || undefined, siteId: input.siteId || undefined, entityType: input.entityType, entityId: input.entityId, action: input.action, details: input.details as any } })
  } catch {
  }
}
