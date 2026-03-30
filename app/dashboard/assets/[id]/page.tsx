import AssetVersionManager from '@/components/AssetVersionManager'
import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { listSupportCasesForAsset } from '@/lib/support'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(param: string | string[] | undefined) {
  return Array.isArray(param) ? param[0] : param
}

export default async function ManageAssetPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params
  const query = await searchParams
  const user = await currentUser()
  if (!user?.vendor) return <div className="empty-state">Create or apply for a seller profile first.</div>
  const site = await getActiveSite()
  const asset = await prisma.asset.findFirst({
    where: { id, siteId: site.id, vendorId: user.vendor.id },
    include: {
      category: true,
      licenseOptions: { orderBy: { sortOrder: 'asc' } },
      versions: { include: { files: true }, orderBy: { createdAt: 'desc' } },
      previews: { orderBy: { sortOrder: 'asc' } },
      tagLinks: { include: { tag: true } },
      metadataEntries: { orderBy: [{ sortOrder: 'asc' }, { fieldLabel: 'asc' }] },
    },
  })
  if (!asset) return <div className="empty-state">Asset not found for your storefront on this marketplace.</div>

  const supportCases = await listSupportCasesForAsset(asset.id)
  const sellerCases = supportCases.filter((item: any) => item.vendorId === user.vendor?.id)
  const hasOpenTakedown = sellerCases.some((item: any) => String(item.type || '').toUpperCase() === 'TAKEDOWN' && !['RESOLVED', 'REJECTED', 'RELEASED'].includes(String(item.status || '').toUpperCase()))
  const counterNoticeState = first(query.counterNotice)
  const editState = first(query.edit)
  const tags = asset.tagLinks.map((link: any) => link.tag.name).join(', ')

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Manage asset</h1>
        <p className="text-gray-600">Edit listing details, review moderation status, and manage versions for {asset.title}.</p>
      </div>
      <DashboardNav />
      {counterNoticeState === 'sent' && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">Counter-notice submitted successfully.</div>}
      {editState === 'saved' && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">Asset updates saved. Approved assets are returned to pending review after seller edits.</div>}
      {editState === 'archived' && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Asset archived.</div>}
      {editState === 'invalid' && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Please complete the required fields before saving.</div>}

      <div className="grid gap-6 lg:grid-cols-[1.15fr,0.85fr]">
        <section className="space-y-4">
          <div className="card">
            <div className="card-body space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{asset.title}</div>
                  <div className="text-sm text-gray-500">{asset.category.name} • {asset.kind} • {asset.status}</div>
                </div>
                <a href={`/assets/${asset.id}`} className="btn-secondary">View public page</a>
              </div>
              <p className="text-sm text-gray-600">{asset.description}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="kv-item"><div className="text-sm text-gray-500">Base price</div><div className="mt-2 text-2xl font-bold">${currencyAmount(asset.priceCents)}</div></div>
                <div className="kv-item"><div className="text-sm text-gray-500">Preview count</div><div className="mt-2 text-2xl font-bold">{asset.previews.length}</div></div>
              </div>
              {asset.rejectionReason && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Moderation note: {asset.rejectionReason}</div>}
              {asset.downloadsDisabled && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Downloads are currently frozen for this asset.</div>}
              {asset.complianceNotes && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Compliance notes: {asset.complianceNotes}</div>}
              {hasOpenTakedown && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">An open takedown/IP case is currently affecting this listing.</div>}
            </div>
          </div>

          <div className="card">
            <form action={`/api/dashboard/assets/${asset.id}`} method="POST" className="card-body space-y-4">
              <h2 className="font-semibold">Edit listing</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div><label className="label">Title</label><input className="input" name="title" defaultValue={asset.title} required /></div>
                <div><label className="label">Short description</label><input className="input" name="shortDescription" defaultValue={asset.shortDescription || ''} /></div>
              </div>
              <div><label className="label">Description</label><textarea className="input min-h-28" name="description" defaultValue={asset.description} required /></div>
              <div className="grid gap-4 md:grid-cols-3">
                <div><label className="label">Base price (cents)</label><input className="input" name="priceCents" type="number" min={50} defaultValue={asset.priceCents} required /></div>
                <div><label className="label">Kind</label><input className="input" name="kind" defaultValue={asset.kind} required /></div>
                <div><label className="label">Preview type</label><input className="input" name="previewType" defaultValue={asset.previewType} required /></div>
              </div>
              <div><label className="label">Tags (comma separated)</label><input className="input" name="tags" defaultValue={tags} /></div>
              <div><label className="label">Metadata JSON</label><textarea className="input min-h-40 font-mono text-xs" name="metadataJson" defaultValue={asset.metadata ? JSON.stringify(asset.metadata, null, 2) : '{}'} /></div>
              <div className="flex flex-wrap gap-3">
                <button className="btn" type="submit">Save listing</button>
                <button className="btn-secondary" type="submit" name="_action" value="archive">Archive asset</button>
                <button className="btn-secondary" type="submit" name="_action" value="delete">Delete asset</button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card-body space-y-4">
              <h2 className="font-semibold">Version history</h2>
              {asset.versions.length ? asset.versions.map((version: any) => (
                <div key={version.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{version.versionLabel} {version.isCurrent && <span className="badge ml-2">Current</span>}</div>
                      <div className="text-sm text-gray-500">{version.createdAt.toDateString()}</div>
                    </div>
                  </div>
                  {version.changelog && <div className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">{version.changelog}</div>}
                  <div className="mt-3 text-sm text-gray-500">Files: {version.files.map((file: any) => file.originalFilename).join(', ') || 'None'}</div>
                </div>
              )) : <div className="empty-state">No versions yet.</div>}
            </div>
          </div>

          <div className="card">
            <div className="card-body space-y-4">
              <h2 className="font-semibold">Support & compliance history</h2>
              {sellerCases.length ? sellerCases.map((item: any) => (
                <div key={item.id} className="rounded-lg border border-gray-200 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3"><div className="font-medium">{String(item.type || '').replace(/_/g, ' ')}</div><div className="badge">{String(item.status || '').replace(/_/g, ' ')}</div></div>
                  <div className="text-sm text-gray-600 whitespace-pre-wrap">{item.message}</div>
                  {item.resolutionNotes && <div className="text-sm text-gray-500">Resolution: {item.resolutionNotes}</div>}
                  {item.counterNoticeText && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700"><div className="font-medium">Counter-notice submitted</div><div className="mt-1 whitespace-pre-wrap">{item.counterNoticeText}</div></div>}
                  {String(item.type || '').toUpperCase() === 'TAKEDOWN' && !item.counterNoticeText && <form action={`/api/support/${item.id}/counter-notice`} method="POST" className="space-y-3"><label className="label">Submit counter-notice</label><textarea className="input min-h-24" name="message" placeholder="Explain why the listing should be reinstated." required /><button className="btn-secondary" type="submit">Send counter-notice</button></form>}
                </div>
              )) : <div className="empty-state">No support or compliance cases for this asset yet.</div>}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="card"><div className="card-body space-y-4"><h2 className="font-semibold">Upload new version</h2><p className="text-sm text-gray-600">Submitting a new version marks the asset as pending again so admins can re-review the updated download package.</p><AssetVersionManager assetId={asset.id} categoryId={asset.categoryId} /></div></div>
          <div className="card"><div className="card-body space-y-3"><h2 className="font-semibold">License options</h2>{asset.licenseOptions.map((option: any) => <div key={option.id} className="rounded-lg border border-gray-200 p-3"><div className="font-medium">{option.name}</div><div className="text-sm text-gray-600">${currencyAmount(option.priceCents ?? asset.priceCents)}</div></div>)}</div></div>
          <div className="card"><div className="card-body space-y-3"><h2 className="font-semibold">Structured metadata</h2>{asset.metadataEntries.length ? asset.metadataEntries.map((entry: any) => <div key={entry.id} className="rounded-lg border border-gray-200 p-3"><div className="text-xs uppercase tracking-wide text-gray-500">{entry.fieldLabel || entry.fieldKey}</div><div className="mt-1 text-sm text-gray-700 break-words">{entry.valueText || JSON.stringify(entry.valueJson)}</div></div>) : <div className="empty-state">No normalized metadata entries yet.</div>}</div></div>
        </aside>
      </div>
    </div>
  )
}
