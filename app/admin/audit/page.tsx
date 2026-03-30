import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(param: string | string[] | undefined) {
  return Array.isArray(param) ? param[0] : param
}

export default async function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  const site = await getActiveSite()
  await requireAdminForSite(site.id)
  const params = await searchParams
  const scope = first(params.scope) || 'all'
  const where: any = { siteId: site.id }
  if (scope === 'suspicious') where.action = { startsWith: 'suspicious.' }
  if (scope === 'moderation') where.action = { contains: 'updated' }

  const logs = await prisma.auditLog.findMany({ where, include: { actor: true }, orderBy: { createdAt: 'desc' }, take: 200 })
  const suspiciousCount = await prisma.auditLog.count({ where: { siteId: site.id, action: { startsWith: 'suspicious.' } } })

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Audit logs</h1>
        <p className="text-gray-600">Review admin changes, operational events, and suspicious activity logs for {site.name}.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href="/admin/audit" className="badge hover:bg-brand-100">All</a>
        <a href="/admin/audit?scope=moderation" className="badge hover:bg-brand-100">Moderation</a>
        <a href="/admin/audit?scope=suspicious" className="badge hover:bg-brand-100">Suspicious ({suspiciousCount})</a>
      </div>
      {logs.length ? (
        <div className="space-y-3">
          {logs.map((log: any) => (
            <div key={log.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{log.action}</div>
                  <div className="text-sm text-gray-500">{log.entityType} • {log.entityId}</div>
                </div>
                <div className="text-sm text-gray-500">{new Date(log.createdAt).toLocaleString()}</div>
              </div>
              <div className="mt-2 text-sm text-gray-600">Actor: {log.actor?.email || 'System'}</div>
              {log.details ? <pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{JSON.stringify(log.details, null, 2)}</pre> : null}
            </div>
          ))}
        </div>
      ) : <div className="empty-state">No audit entries match the current filter.</div>}
    </div>
  )
}
