import type { Metadata } from 'next'
import SaveAssetButton from '@/components/SaveAssetButton'
import { AudioPlayer, CodePreview, DocumentPreview, FilePreview, FontPreview, ImageViewer, VideoPlayer } from '@/components/Players'
import { currentUser } from '@/lib/auth'
import { isAssetSavedByUser } from '@/lib/collections'
import { prisma } from '@/lib/prisma'
import { getActiveSite, storefrontPath } from '@/lib/site'
import { listSupportCasesForAsset } from '@/lib/support'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

type AssetMetadataRow = {
  key: string
  label: string
  value: string
}

function first(param: string | string[] | undefined) {
  return Array.isArray(param) ? param[0] : param
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function normalizeMetadata(asset: any): AssetMetadataRow[] {
  if (Array.isArray(asset.metadataEntries) && asset.metadataEntries.length) {
    return asset.metadataEntries
      .map((entry: any) => ({
        key: entry.fieldKey,
        label: entry.fieldLabel || entry.fieldKey,
        value: displayValue(entry.valueText ?? entry.valueJson),
      }))
      .filter((entry: AssetMetadataRow) => entry.value)
  }

  return Object.entries((asset.metadata || {}) as Record<string, unknown>)
    .map(([key, value]) => ({ key, label: key, value: displayValue(value) }))
    .filter((entry) => entry.value)
}

async function getAsset(siteId: string, id: string) {
  return prisma.asset.findFirst({
    where: { id, siteId, status: 'APPROVED' },
    include: {
      vendor: true,
      vendorSiteMembership: true,
      category: true,
      previews: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      files: { orderBy: { createdAt: 'asc' } },
      versions: { where: { isCurrent: true }, take: 1, orderBy: { createdAt: 'desc' } },
      licenseOptions: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      tagLinks: { include: { tag: true } },
      metadataEntries: { orderBy: [{ sortOrder: 'asc' }, { fieldLabel: 'asc' }] },
    },
  })
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params
  const site = await getActiveSite()
  const asset = await getAsset(site.id, id)
  if (!asset) return { title: `${site.name} asset`, description: site.seoDescription || `${site.name} digital asset listing` }
  return {
    title: `${asset.title} • ${site.name}`,
    description: asset.shortDescription || asset.description.slice(0, 160) || site.seoDescription || `${asset.title} on ${site.name}`,
  }
}

export default async function AssetDetail({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, query, site] = await Promise.all([params, searchParams, getActiveSite()])
  const asset = await getAsset(site.id, id)
  if (!asset) return <div className="empty-state">Asset not found for this marketplace.</div>

  const user = await currentUser()
  const supportCases = await listSupportCasesForAsset(asset.id)
  const [purchases, isSaved] = user
    ? await Promise.all([
        prisma.purchase.findMany({
          where: { userId: user.id, assetId: asset.id, siteId: site.id },
          include: { licenseOption: true, order: true },
          orderBy: { createdAt: 'desc' },
        }),
        isAssetSavedByUser(user.id, site.id, asset.id),
      ])
    : [[], false]

  const userCases = user ? supportCases.filter((item: any) => item.reporterUserId === user.id || item.vendorId === user.vendor?.id) : []
  const metadata = (asset.metadata || {}) as Record<string, unknown>
  const metadataRows = normalizeMetadata(asset)
  const primaryPreview = asset.previews[0] || null
  const previewSource = primaryPreview?.url || asset.previewUrl || null
  const previewSizeBytes = primaryPreview?.metadata && typeof primaryPreview.metadata === 'object' ? Number((primaryPreview.metadata as any).sizeBytes || 0) || null : null
  const sellerName = asset.vendorSiteMembership?.storefrontName || asset.vendor.displayName
  const supportState = first(query.support)
  const counterNoticeState = first(query.counterNotice)
  const checkoutState = first(query.checkout)
  const downloadState = first(query.download)
  const takedownOpen = supportCases.some((item: any) => String(item.type || '').toUpperCase() === 'TAKEDOWN' && !['RESOLVED', 'REJECTED', 'RELEASED'].includes(String(item.status || '').toUpperCase()))
  const ownedLicenseIds = new Set(purchases.map((purchase: any) => purchase.licenseOptionId || '__base__'))
  const latestPurchase = purchases[0] || null
  const hasCustomLicenses = asset.licenseOptions.length > 0
  const ownsBaseLicense = ownedLicenseIds.has('__base__') || (!hasCustomLicenses && purchases.length > 0)
  const availableLicenseOptions = hasCustomLicenses ? asset.licenseOptions.filter((option: any) => !ownedLicenseIds.has(option.id)) : []
  const allLicensesOwned = hasCustomLicenses ? availableLicenseOptions.length === 0 : ownsBaseLicense
  const codeNotes = [
    metadata.readme ? { title: 'README', body: String(metadata.readme) } : null,
    metadata.documentation ? { title: 'Documentation', body: String(metadata.documentation) } : null,
    metadata.changelog ? { title: 'Changelog', body: String(metadata.changelog) } : null,
  ].filter(Boolean) as { title?: string; body?: string }[]

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr,1fr]">
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="text-sm text-gray-500">
            <a href="/" className="text-brand-700">Home</a> / <a href={`/category/${asset.category.slug}`} className="text-brand-700">{asset.category.name}</a> / {asset.title}
          </div>
          <h1 className="text-3xl font-bold">{asset.title}</h1>
          <p className="text-gray-600">{asset.description}</p>
          <div className="flex flex-wrap gap-2">
            <span className="badge">{asset.kind}</span>
            <span className="badge">{asset.previewType}</span>
            <span className="badge">Version {asset.versions[0]?.versionLabel || '1.0.0'}</span>
            <a href={storefrontPath(asset.vendorSiteMembership?.storefrontSlug)} className="badge hover:bg-brand-100">Seller: {sellerName}</a>
          </div>
          {asset.tagLinks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {asset.tagLinks.map((tagLink: any) => (
                <a key={tagLink.tag.id} href={`/search?tag=${tagLink.tag.slug}`} className="badge hover:bg-brand-100">#{tagLink.tag.name}</a>
              ))}
            </div>
          ) : null}
          <div className="space-y-2">
            {supportState === 'sent' ? <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">Support request sent successfully.</div> : null}
            {supportState === 'not-eligible' ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">A refund or dispute requires a matching purchase on this marketplace.</div> : null}
            {supportState === 'download-frozen' ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">This listing is temporarily unavailable while downloads are frozen.</div> : null}
            {counterNoticeState === 'sent' ? <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">Counter-notice submitted successfully.</div> : null}
            {checkoutState === 'owned' ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">You already own that license tier on this marketplace.</div> : null}
            {downloadState === 'disabled' || downloadState === 'frozen' ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Downloads are temporarily frozen for this asset while it is under review.</div> : null}
            {downloadState === 'rate-limited' ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Download temporarily blocked due to burst activity. Please wait before trying again.</div> : null}
            {downloadState === 'missing-file' ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">The latest download file could not be found for this asset.</div> : null}
            {asset.downloadsDisabled ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Downloads are currently frozen for this asset while a compliance or support review is in progress.</div> : null}
            {takedownOpen ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">A takedown or IP review is currently open for this listing.</div> : null}
          </div>
        </div>

        <div>
          {asset.previewType === 'IMAGE' && previewSource ? <ImageViewer src={previewSource} alt={asset.title} /> : null}
          {asset.previewType === 'AUDIO' && previewSource ? <AudioPlayer src={previewSource} /> : null}
          {asset.previewType === 'VIDEO' && previewSource ? <VideoPlayer src={previewSource} /> : null}
          {asset.previewType === 'CODE' ? (
            <CodePreview
              code={String(metadata.codeSample || '// Add a code preview snippet in asset metadata under `codeSample`.')}
              language={String(metadata.codeLanguage || metadata.language || 'Source preview')}
              filename={String(metadata.codeFilename || metadata.sampleFile || 'sample.txt')}
              notes={codeNotes}
            />
          ) : null}
          {asset.previewType === 'PDF' && previewSource ? <DocumentPreview src={previewSource} /> : null}
          {asset.previewType === 'FONT' && previewSource ? <FontPreview src={previewSource} sampleText={String(metadata.fontSample || '')} /> : null}
          {asset.previewType === 'FILE' ? (
            <FilePreview
              href={previewSource}
              label={primaryPreview?.type || 'Preview file'}
              mimeType={primaryPreview?.mimeType || String(metadata.previewMimeType || '') || null}
              sizeBytes={previewSizeBytes}
              message={previewSource ? 'Open the supplied preview file to inspect the package, screenshots, sample document, or archive contents.' : 'Inline preview is not available for this asset type.'}
            />
          ) : null}
        </div>

        {asset.previews.length > 1 ? (
          <section className="space-y-3">
            <h2 className="font-semibold">Additional previews</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {asset.previews.slice(1).map((preview: any) => (
                <a key={preview.id} href={preview.url} target="_blank" rel="noreferrer" className="card hover:shadow-md">
                  <div className="card-body">
                    <div className="text-sm font-medium">{preview.type}</div>
                    <div className="text-xs text-gray-500 break-all">{preview.url}</div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="font-semibold">Asset details</h2>
          {metadataRows.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {metadataRows.map((entry) => (
                <div key={entry.key} className="kv-item">
                  <div className="text-xs uppercase tracking-wide text-gray-500">{entry.label}</div>
                  <div className="mt-1 break-words text-sm text-gray-800">{entry.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No structured metadata has been supplied for this asset yet.</div>
          )}
        </section>

        {asset.files.length ? (
          <section className="space-y-3">
            <h2 className="font-semibold">Included files</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {asset.files.map((file: any) => (
                <div key={file.id} className="kv-item">
                  <div className="text-xs uppercase tracking-wide text-gray-500">{file.kind}</div>
                  <div className="mt-1 font-medium text-gray-900">{file.originalFilename}</div>
                  <div className="mt-1 text-sm text-gray-600">{file.mimeType} • {(Number(file.sizeBytes || 0) / 1024 / 1024).toFixed(2)} MB</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {userCases.length > 0 ? (
          <section className="space-y-3">
            <h2 className="font-semibold">Your support history</h2>
            <div className="space-y-3">
              {userCases.map((item: any) => (
                <div key={item.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="font-medium">{String(item.type || '').replace(/_/g, ' ')}</div>
                    <div className="badge">{String(item.status || '').replace(/_/g, ' ')}</div>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{item.message}</div>
                  {item.resolutionNotes ? <div className="mt-2 text-sm text-gray-500">Resolution: {item.resolutionNotes}</div> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <aside className="space-y-4">
        <div className="card">
          <div className="card-body space-y-4">
            <div>
              <div className="text-sm text-gray-500">Starting at</div>
              <div className="text-3xl font-bold">${currencyAmount(asset.priceCents)}</div>
              <div className="text-sm text-gray-500">{asset.currency}</div>
            </div>

            {purchases.length ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
                  You own {purchases.length} license{purchases.length === 1 ? '' : 's'} for this asset on {site.name}.
                </div>
                <div className="space-y-2">
                  {purchases.map((purchase: any) => (
                    <div key={purchase.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-gray-900">{purchase.licenseOption?.name || 'Standard license'}</div>
                        <div className="badge">{purchase.createdAt.toDateString()}</div>
                      </div>
                      <div className="mt-1 text-gray-600">License key: {purchase.licenseKey}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <a href={`/dashboard/orders/${purchase.orderId}`} className="btn-secondary">Receipt</a>
                      </div>
                    </div>
                  ))}
                </div>
                {asset.downloadsDisabled ? (
                  <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Redownloads are temporarily disabled for this item.</div>
                ) : (
                  <form action={`/api/download/${asset.id}`} method="POST">
                    <button className="btn w-full" type="submit">Download again</button>
                  </form>
                )}
                <a href="/dashboard/downloads" className="btn-secondary w-full">View download library</a>
              </div>
            ) : null}

            {!asset.downloadsDisabled && (!purchases.length || !allLicensesOwned) ? (
              <form action="/api/checkout" method="POST" className="space-y-3">
                <input type="hidden" name="assetId" value={asset.id} />
                {asset.licenseOptions.length > 0 ? (
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <div className="font-medium">{purchases.length ? 'Buy an additional license' : 'Choose license'}</div>
                    {asset.licenseOptions.map((option: any, index: number) => {
                      const price = option.priceCents ?? asset.priceCents
                      const owned = ownedLicenseIds.has(option.id)
                      return (
                        <label key={option.id} className={`flex items-start gap-3 rounded-md border p-3 ${owned ? 'border-green-200 bg-green-50' : 'cursor-pointer border-gray-200 hover:border-brand-300'}`}>
                          <input type="radio" name="licenseOptionId" value={option.id} defaultChecked={!owned && (availableLicenseOptions[0]?.id || asset.licenseOptions[0]?.id) === option.id} disabled={owned} />
                          <div className="space-y-1">
                            <div className="font-medium">
                              {option.name} <span className="text-gray-500">— ${currencyAmount(price)}</span>
                            </div>
                            {option.description ? <div className="text-sm text-gray-600">{option.description}</div> : null}
                            {owned ? <div className="text-xs font-medium text-green-700">Already owned on this site</div> : null}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                ) : !purchases.length ? null : null}
                {asset.licenseOptions.length === 0 && purchases.length ? null : <button className="btn w-full" type="submit">{purchases.length ? 'Buy selected license' : 'Buy now'}</button>}
              </form>
            ) : null}

            {asset.downloadsDisabled && !purchases.length ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">This listing is temporarily not available for checkout.</div> : null}
            <SaveAssetButton assetId={asset.id} signedIn={Boolean(user)} initiallySaved={isSaved} />
            <div className="text-sm text-gray-500">Sold by {sellerName}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-body space-y-3">
            <h2 className="font-semibold">License summary</h2>
            {asset.licenseOptions.length ? (
              asset.licenseOptions.map((option: any) => (
                <div key={option.id} className="space-y-1 rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{option.name}</div>
                    {ownedLicenseIds.has(option.id) ? <div className="badge">Owned</div> : null}
                  </div>
                  <div className="text-sm text-gray-600">{option.description || 'Custom license option.'}</div>
                  {option.licenseText ? <div className="whitespace-pre-wrap text-xs text-gray-500">{option.licenseText}</div> : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-600">Single-user commercial license. No redistribution or resale.</p>
            )}
          </div>
        </div>

        {user ? (
          <div className="card">
            <div className="card-body space-y-4">
              <h2 className="font-semibold">Support</h2>
              {latestPurchase ? (
                <form action="/api/support" method="POST" className="space-y-3">
                  <input type="hidden" name="type" value="refund" />
                  <input type="hidden" name="assetId" value={asset.id} />
                  <input type="hidden" name="orderId" value={latestPurchase.orderId} />
                  <label className="label">Request refund</label>
                  <textarea className="input min-h-24" name="message" placeholder="Why are you requesting a refund?" required />
                  <button className="btn-secondary w-full" type="submit">Submit refund request</button>
                </form>
              ) : null}
              {latestPurchase ? (
                <form action="/api/support" method="POST" className="space-y-3">
                  <input type="hidden" name="type" value="dispute" />
                  <input type="hidden" name="assetId" value={asset.id} />
                  <input type="hidden" name="orderId" value={latestPurchase.orderId} />
                  <label className="label">Open dispute</label>
                  <textarea className="input min-h-24" name="message" placeholder="Describe the dispute or license issue." required />
                  <button className="btn-secondary w-full" type="submit">Submit dispute</button>
                </form>
              ) : null}
              <form action="/api/support" method="POST" className="space-y-3">
                <input type="hidden" name="type" value="takedown" />
                <input type="hidden" name="assetId" value={asset.id} />
                <label className="label">Report takedown/IP issue</label>
                <textarea className="input min-h-24" name="message" placeholder="Describe the infringement or takedown concern." required />
                <button className="btn-secondary w-full" type="submit">Submit takedown report</button>
              </form>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  )
}
