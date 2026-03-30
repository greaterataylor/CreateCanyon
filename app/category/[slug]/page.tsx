import type { Metadata } from 'next'
import AssetCard from '@/components/AssetCard'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'

export const dynamic = 'force-dynamic'

type Params = Promise<{ slug: string }>

async function getCategory(siteId: string, slug: string) {
  return prisma.category.findFirst({
    where: {
      siteId,
      slug,
      isActive: true,
      OR: [{ visibilities: { none: {} } }, { visibilities: { some: { siteId, enabled: true } } }],
    },
    include: {
      parent: true,
      children: {
        where: {
          isActive: true,
          OR: [{ visibilities: { none: {} } }, { visibilities: { some: { siteId, enabled: true } } }],
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      },
    },
  })
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const site = await getActiveSite()
  const category = await getCategory(site.id, slug)
  if (!category) return { title: site.name, description: site.seoDescription || `${site.name} categories` }
  return {
    title: `${category.name} • ${site.name}`,
    description: category.description || site.seoDescription || `${category.name} assets on ${site.name}`,
  }
}

export default async function CategoryPage({ params }: { params: Params }) {
  const { slug } = await params
  const site = await getActiveSite()
  const category = await getCategory(site.id, slug)
  if (!category) return <div className="empty-state">Category not found.</div>

  const assets = await prisma.asset.findMany({
    where: { siteId: site.id, categoryId: category.id, status: 'APPROVED', downloadsDisabled: false },
    include: { vendor: true, category: true },
    orderBy: [{ createdAt: 'desc' }],
  })

  return (
    <div className="space-y-6">
      {category.bannerUrl ? (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <img src={category.bannerUrl} alt={category.name} className="h-56 w-full object-cover" />
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="text-sm text-gray-500">
          <a href="/" className="text-brand-700">Home</a>
          {category.parent ? (
            <>
              {' / '}
              <a href={`/category/${category.parent.slug}`} className="text-brand-700">{category.parent.name}</a>
            </>
          ) : null}
          {' / '}
          {category.name}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{category.name}</h1>
          {category.icon ? <span className="badge">{category.icon}</span> : null}
          {category.featured ? <span className="badge">Featured</span> : null}
        </div>
        {category.description ? <p className="max-w-3xl text-gray-600">{category.description}</p> : null}
      </div>

      {category.children.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-semibold">Subcategories</h2>
          <div className="flex flex-wrap gap-2">
            {category.children.map((child: any) => (
              <a key={child.id} href={`/category/${child.slug}`} className="badge hover:bg-brand-100">{child.name}</a>
            ))}
          </div>
        </section>
      ) : null}

      {assets.length ? (
        <ul className="asset-grid">
          {assets.map((asset: any) => (
            <li key={asset.id}><AssetCard asset={asset} /></li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">No approved assets are currently listed in this category.</div>
      )}
    </div>
  )
}
