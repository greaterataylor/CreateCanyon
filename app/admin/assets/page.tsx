import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function AdminAssets() {
  const site = await getActiveSite()
  const siteId = site.id
  await requireAdminForSite(siteId)
  const assets = await prisma.asset.findMany({ where: { siteId }, include: { vendor: true, category: true, versions: { where: { isCurrent: true }, take: 1 }, licenseOptions: { orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'desc' } })

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Assets</h1>
        <p className="text-gray-600">Moderate listings, set rejection reasons, and run bulk asset actions for {site.name}.</p>
      </div>

      <form id="bulk-assets-form" action="/api/admin/assets/bulk" method="POST" className="card">
        <div className="card-body grid gap-4 md:grid-cols-[1fr,1.4fr,auto]">
          <div>
            <label className="label">Bulk status</label>
            <select className="input" name="status" defaultValue="APPROVED"><option>DRAFT</option><option>PENDING</option><option>APPROVED</option><option>REJECTED</option><option>ARCHIVED</option></select>
          </div>
          <div>
            <label className="label">Rejection reason / moderation note</label>
            <input className="input" name="rejectionReason" placeholder="Optional rejection reason or moderation note" />
          </div>
          <div className="flex items-end"><button className="btn" type="submit">Apply to selected assets</button></div>
        </div>
      </form>

      {assets.length ? (
        <div className="space-y-4">
          {assets.map((asset: any) => (
            <div key={asset.id} className="card">
              <div className="card-body space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <input form="bulk-assets-form" type="checkbox" name="assetIds" value={asset.id} className="mt-1" />
                    <div>
                      <a href={`/assets/${asset.id}`} className="text-lg font-semibold text-brand-700">{asset.title}</a>
                      <div className="text-sm text-gray-500">{asset.category.name} • {asset.vendor.displayName}</div>
                      <div className="text-sm text-gray-500">Base price ${currencyAmount(asset.priceCents)} • Version {asset.versions[0]?.versionLabel || '1.0.0'}</div>
                    </div>
                  </div>
                  <div className="badge">{asset.status}</div>
                </div>
                <div className="rounded-lg border border-gray-200 p-3 text-sm text-gray-600">License options: {asset.licenseOptions.map((option: any) => `${option.name}: $${currencyAmount(option.priceCents ?? asset.priceCents)}`).join(' • ') || 'Standard only'}</div>
                <form action={`/api/admin/assets/${asset.id}`} method="POST" className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="label">Moderation status</label>
                    <select className="input" name="status" defaultValue={asset.status}><option>DRAFT</option><option>PENDING</option><option>APPROVED</option><option>REJECTED</option><option>ARCHIVED</option></select>
                  </div>
                  <div>
                    <label className="label">Rejection reason / moderation note</label>
                    <textarea className="input min-h-24" name="rejectionReason" defaultValue={asset.rejectionReason || ''} />
                  </div>
                  <div className="md:col-span-2"><button className="btn" type="submit">Save moderation decision</button></div>
                </form>
              </div>
            </div>
          ))}
        </div>
      ) : <div className="empty-state">No assets have been submitted for this marketplace yet.</div>}
    </div>
  )
}
