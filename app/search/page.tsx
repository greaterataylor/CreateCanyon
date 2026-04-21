import Link from 'next/link'
import AssetCard from '@/components/AssetCard'
import { prisma } from '@/lib/prisma'
import { normalizeSearchSort, searchAssets, type SearchFacetItem } from '@/lib/search'
import { getActiveSite } from '@/lib/site'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(param: string | string[] | undefined) {
  return Array.isArray(param) ? param[0] : param
}

function searchHref(current: Record<string, string>, updates: Record<string, string | null | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...current, ...updates })) {
    if (value == null || value === '') continue
    params.set(key, value)
  }
  const qs = params.toString()
  return qs ? `/search?${qs}` : '/search'
}

function FacetGroup({
  title,
  items,
  current,
  param,
  baseFilters,
}: {
  title: string
  items: SearchFacetItem[]
  current: string
  param: string
  baseFilters: Record<string, string>
}) {
  if (!items.length) return null
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-sm font-semibold text-gray-900">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => {
          const active = current === item.value
          return (
            <Link
              key={`${param}:${item.value}`}
              href={searchHref(baseFilters, { [param]: active ? '' : item.value })}
              className={`rounded-full border px-3 py-1 text-xs transition ${active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'}`}
            >
              {item.label} ({item.count})
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const site = await getActiveSite()
  const q = first(params.q)?.trim() || ''
  const categoryId = first(params.category) || ''
  const kind = first(params.kind) || ''
  const tag = first(params.tag) || ''
  const vendorId = first(params.vendor) || ''
  const min = Number(first(params.min) || 0)
  const max = Number(first(params.max) || 0)
  const sort = normalizeSearchSort(first(params.sort), Boolean(q))

  const [categories, tags, vendors, results] = await Promise.all([
    prisma.category.findMany({ where: { siteId: site.id, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.assetTag.findMany({ where: { siteId: site.id }, orderBy: { name: 'asc' }, take: 100 }),
    prisma.vendor.findMany({ where: { memberships: { some: { siteId: site.id, status: 'APPROVED' } } }, orderBy: { displayName: 'asc' }, take: 100 }),
    searchAssets({ siteId: site.id, q, categoryId, kind, tag, vendorId, min: min || undefined, max: max || undefined, sort }),
  ])

  const baseFilters = {
    q,
    category: categoryId,
    kind,
    tag,
    vendor: vendorId,
    min: min ? String(min) : '',
    max: max ? String(max) : '',
    sort,
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2"><h1 className="text-2xl font-bold">Search assets</h1><p className="text-gray-600">Search and filter approved assets for {site.name}.</p></div>
      <form className="card">
        <div className="card-body grid gap-4 md:grid-cols-8">
          <div className="md:col-span-2"><label className="label">Keyword</label><input className="input" name="q" defaultValue={q} placeholder="Search titles, tags, vendors, and metadata" /></div>
          <div><label className="label">Category</label><select className="input" name="category" defaultValue={categoryId}><option value="">All</option>{categories.map((category: any) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
          <div><label className="label">Kind</label><select className="input" name="kind" defaultValue={kind}><option value="">All</option><option value="IMAGE">Image</option><option value="GRAPHIC">Graphic</option><option value="AUDIO">Audio</option><option value="VIDEO">Video</option><option value="FONT">Font</option><option value="CODE">Code</option><option value="DOCUMENT">Document</option><option value="TEMPLATE">Template</option><option value="BUNDLE">Bundle</option><option value="OTHER">Other</option></select></div>
          <div><label className="label">Tag</label><select className="input" name="tag" defaultValue={tag}><option value="">Any</option>{tags.map((item: any) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></div>
          <div><label className="label">Vendor</label><select className="input" name="vendor" defaultValue={vendorId}><option value="">Any</option>{vendors.map((vendor: any) => <option key={vendor.id} value={vendor.id}>{vendor.displayName}</option>)}</select></div>
          <div><label className="label">Min cents</label><input className="input" type="number" min={0} name="min" defaultValue={min || ''} /></div>
          <div><label className="label">Max cents</label><input className="input" type="number" min={0} name="max" defaultValue={max || ''} /></div>
          <div><label className="label">Sort</label><select className="input" name="sort" defaultValue={sort}><option value="relevance">Best match</option><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="popular">Popular</option></select></div>
          <div className="md:col-span-8 flex flex-wrap items-center gap-3"><button className="btn" type="submit">Apply filters</button><Link href="/search" className="text-sm text-gray-600 underline-offset-4 hover:underline">Clear all filters</Link><div className="text-sm text-gray-500">{results.total} result{results.total === 1 ? '' : 's'}.</div></div>
        </div>
      </form>

      {(results.facets.categories.length || results.facets.vendors.length || results.facets.tags.length || results.facets.kinds.length) && (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <FacetGroup title="Categories" items={results.facets.categories} current={categoryId} param="category" baseFilters={baseFilters} />
          <FacetGroup title="Vendors" items={results.facets.vendors} current={vendorId} param="vendor" baseFilters={baseFilters} />
          <FacetGroup title="Tags" items={results.facets.tags} current={tag} param="tag" baseFilters={baseFilters} />
          <FacetGroup title="Kinds" items={results.facets.kinds} current={kind} param="kind" baseFilters={baseFilters} />
        </div>
      )}

      {results.items.length ? <ul className="asset-grid">{results.items.map((asset: any) => <li key={asset.id}><AssetCard asset={asset} /></li>)}</ul> : <div className="empty-state">No approved assets match the current filters.</div>}
    </div>
  )
}
