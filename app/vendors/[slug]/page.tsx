import type { Metadata } from 'next'
import AssetCard from '@/components/AssetCard'
import { prisma } from '@/lib/prisma'
import { getActiveSite, storefrontPath } from '@/lib/site'

export const dynamic = 'force-dynamic'

type Params = Promise<{ slug: string }>

async function loadMembership(siteId: string, slug: string) {
  return prisma.vendorSiteMembership.findUnique({
    where: { siteId_storefrontSlug: { siteId, storefrontSlug: slug } },
    include: {
      vendor: true,
      assets: {
        where: { siteId, status: 'APPROVED', downloadsDisabled: false },
        include: { category: true, vendor: true, vendorSiteMembership: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const site = await getActiveSite()
  const membership = await loadMembership(site.id, slug)
  const title = membership?.storefrontName || membership?.vendor.displayName || 'Seller storefront'
  return {
    title: `${title} • ${site.name}`,
    description: membership?.headline || membership?.vendor.bio || `Seller storefront on ${site.name}.`,
  }
}

export default async function VendorPage({ params }: { params: Params }) {
  const { slug } = await params
  const site = await getActiveSite()
  const membership = await loadMembership(site.id, slug)
  if (!membership || membership.status !== 'APPROVED') {
    return <div className="empty-state">Seller storefront not found for this marketplace.</div>
  }

  const vendor = membership.vendor
  return (
    <div className="space-y-6">
      <section className="card">
        <div className="card-body space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold">{membership.storefrontName || vendor.displayName}</h1>
              <div className="text-sm text-gray-500">Storefront URL: {storefrontPath(membership.storefrontSlug)}</div>
            </div>
            <a href="/dashboard/store" className="btn-secondary">Manage my store</a>
          </div>
          <p className="text-gray-600">{membership.headline || vendor.bio || 'Independent seller storefront.'}</p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">Published assets</h2>
          <div className="text-sm text-gray-500">{membership.assets.length} item(s)</div>
        </div>
        {membership.assets.length ? (
          <ul className="asset-grid">
            {membership.assets.map((asset: any) => (
              <li key={asset.id}><AssetCard asset={asset} /></li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">This seller has not published any approved assets on this site yet.</div>
        )}
      </section>
    </div>
  )
}
