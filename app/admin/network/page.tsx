import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function AdminNetworkPage() {
  await requireSuperAdmin()
  const sites = await prisma.site.findMany({
    include: {
      _count: { select: { assets: true, vendorMemberships: true, orders: true, supportCases: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const suspicious = await prisma.auditLog.findMany({ where: { action: { startsWith: 'suspicious.' } }, include: { site: true }, orderBy: { createdAt: 'desc' }, take: 50 })

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Network admin</h1>
        <p className="text-gray-600">Cross-market visibility for all sites, including suspicious activity across the full ZenBinary marketplace network.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sites.map((site: any) => (
          <div key={site.id} className="card">
            <div className="card-body space-y-2">
              <div className="font-semibold">{site.name}</div>
              <div className="text-sm text-gray-500">Slug: {site.slug}{site.domain ? ` • ${site.domain}` : ''}</div>
              <div className="grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
                <div>Assets: {site._count.assets}</div>
                <div>Vendors: {site._count.vendorMemberships}</div>
                <div>Orders: {site._count.orders}</div>
                <div>Support cases: {site._count.supportCases}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <section className="card">
        <div className="card-body space-y-3">
          <h2 className="font-semibold">Recent suspicious activity</h2>
          {suspicious.length ? suspicious.map((log: any) => (
            <div key={log.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium">{log.action}</div>
                <div className="text-sm text-gray-500">{new Date(log.createdAt).toLocaleString()}</div>
              </div>
              <div className="text-sm text-gray-600">{log.site?.name || 'Unknown site'} • {log.entityType} • {log.entityId}</div>
              {log.details ? <pre className="mt-2 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{JSON.stringify(log.details, null, 2)}</pre> : null}
            </div>
          )) : <div className="empty-state">No suspicious events have been logged yet.</div>}
        </div>
      </section>
    </div>
  )
}
