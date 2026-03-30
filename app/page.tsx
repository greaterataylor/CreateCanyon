import AssetCard from '@/components/AssetCard'
import { prisma, isPrismaConnectionError } from '@/lib/prisma'
import { getActiveSite, storefrontPath } from '@/lib/site'
import { getHomeContent, getLegalDocuments } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const site = await getActiveSite()
  const home = getHomeContent(site.settings, site.name)
  const legalDocs = getLegalDocuments(site.settings)

  let categories: any[] = []
  let assets: any[] = []
  let topVendors: any[] = []
  let totalAssetsCount = 0

  try {
    ;[categories, assets, topVendors, totalAssetsCount] = await Promise.all([
      prisma.category.findMany({
        where: { siteId: site.id, isActive: true, OR: [{ visibilities: { none: {} } }, { visibilities: { some: { siteId: site.id, enabled: true } } }] },
        orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        take: 16,
      }),
      prisma.asset.findMany({
        where: { siteId: site.id, status: 'APPROVED', downloadsDisabled: false },
        include: { vendor: true, category: true, vendorSiteMembership: true },
        orderBy: { createdAt: 'desc' },
        take: 24,
      }),
      prisma.vendorSiteMembership.findMany({ where: { siteId: site.id, status: 'APPROVED' }, include: { vendor: true }, orderBy: { updatedAt: 'desc' }, take: 6 }),
      prisma.asset.count({ where: { siteId: site.id, status: 'APPROVED', downloadsDisabled: false } }),
    ])
  } catch (error) {
    if (!isPrismaConnectionError(error)) throw error
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.4fr,1fr]">
        <div className="card bg-gradient-to-br from-brand-50 to-white">
          <div className="card-body space-y-4">
            <span className="badge">{home.eyebrow}</span>
            <div className="flex flex-wrap items-center gap-4">
              {site.logoUrl ? <img src={site.logoUrl} alt={site.name} className="h-12 w-12 rounded-lg object-cover border border-gray-200" /> : null}
              <div>
                <h1 className="text-3xl font-bold sm:text-4xl">{home.title}</h1>
                <p className="mt-2 max-w-2xl text-gray-600">{home.description}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href={home.primaryCtaHref} className="btn">{home.primaryCtaLabel}</a>
              <a href={home.secondaryCtaHref} className="btn-secondary">{home.secondaryCtaLabel}</a>
              <a href="#latest-assets" className="btn-secondary">Browse latest assets</a>
            </div>
            <div className="flex flex-wrap gap-2">
              {home.trustBadges.map((badge) => <span key={badge} className="badge">{badge}</span>)}
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <div className="kv-item"><div className="text-sm text-gray-500">Active categories</div><div className="mt-2 text-3xl font-bold">{categories.length}</div></div>
          <div className="kv-item"><div className="text-sm text-gray-500">Published assets</div><div className="mt-2 text-3xl font-bold">{totalAssetsCount}</div></div>
          <div className="kv-item"><div className="text-sm text-gray-500">Legal docs managed in data</div><div className="mt-2 text-3xl font-bold">{legalDocs.length}</div></div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3"><h2 className="section-title">Browse categories</h2><div className="text-sm text-gray-500">Site-scoped taxonomy</div></div>
        <div className="flex flex-wrap gap-2">{categories.map((category: any) => <a key={category.id} href={`/category/${category.slug}`} className="badge hover:bg-brand-100">{category.name}</a>)}</div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3"><h2 className="section-title">Featured sellers</h2><a href="/dashboard/store" className="text-sm text-brand-700">Become a seller</a></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{topVendors.length ? topVendors.map((membership: any) => <a key={membership.id} href={storefrontPath(membership.storefrontSlug)} className="card hover:shadow-md"><div className="card-body space-y-2"><div className="text-lg font-semibold">{membership.storefrontName || membership.vendor.displayName}</div><div className="text-sm text-gray-600">{membership.headline || membership.vendor.bio || 'Seller storefront'}</div><div className="text-xs text-gray-500">Store URL: {storefrontPath(membership.storefrontSlug)}</div></div></a>) : <div className="empty-state md:col-span-2 xl:col-span-3">No sellers have been approved for this marketplace yet.</div>}</div>
      </section>

      <section id="latest-assets" className="space-y-3">
        <div className="flex items-center justify-between gap-3"><h2 className="section-title">Latest approved assets</h2><a href="/search" className="text-sm text-brand-700">Open advanced search</a></div>
        {assets.length ? <ul className="asset-grid">{assets.map((asset: any) => <li key={asset.id}><AssetCard asset={asset} /></li>)}</ul> : <div className="empty-state">No approved assets have been published for this marketplace yet.</div>}
      </section>
    </div>
  )
}
