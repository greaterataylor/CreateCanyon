import { prisma } from './prisma'

export type SearchSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'popular'

export type SearchFacetItem = {
  value: string
  label: string
  count: number
}

export type SearchAssetsResult = {
  items: any[]
  total: number
  facets: {
    categories: SearchFacetItem[]
    kinds: SearchFacetItem[]
    vendors: SearchFacetItem[]
    tags: SearchFacetItem[]
  }
}

function normalizedText(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function queryTokens(value: string) {
  return normalizedText(value).split(/\s+/).filter(Boolean)
}

function scoreField(value: unknown, phrase: string, tokens: string[], weights: { exact: number; startsWith: number; includes: number; token: number }) {
  const haystack = normalizedText(value)
  if (!haystack) return 0

  let score = 0
  if (phrase) {
    if (haystack === phrase) score += weights.exact
    else if (haystack.startsWith(phrase)) score += weights.startsWith
    else if (haystack.includes(phrase)) score += weights.includes
  }

  for (const token of tokens) {
    if (!token) continue
    if (haystack === token) score += weights.exact
    else if (haystack.startsWith(token)) score += weights.startsWith
    else if (haystack.includes(token)) score += weights.token
  }

  return score
}

function scoreAsset(asset: any, query: string) {
  const phrase = normalizedText(query)
  const tokens = queryTokens(query)
  if (!phrase && !tokens.length) return 0

  const tags = Array.isArray(asset.tagLinks) ? asset.tagLinks.map((link: any) => link.tag?.name || link.tag?.slug || '').join(' ') : ''
  const metadata = Array.isArray(asset.metadataEntries) ? asset.metadataEntries.map((entry: any) => entry.valueText || '').join(' ') : ''
  const popularity = (Number(asset?._count?.purchases || 0) * 3) + Number(asset?._count?.downloadEvents || 0)

  let score = 0
  score += scoreField(asset.title, phrase, tokens, { exact: 160, startsWith: 100, includes: 60, token: 20 })
  score += scoreField(asset.shortDescription, phrase, tokens, { exact: 30, startsWith: 20, includes: 14, token: 6 })
  score += scoreField(asset.description, phrase, tokens, { exact: 22, startsWith: 14, includes: 10, token: 4 })
  score += scoreField(asset.vendor?.displayName, phrase, tokens, { exact: 55, startsWith: 34, includes: 20, token: 8 })
  score += scoreField(asset.vendor?.slug, phrase, tokens, { exact: 42, startsWith: 26, includes: 16, token: 6 })
  score += scoreField(asset.category?.name, phrase, tokens, { exact: 38, startsWith: 24, includes: 16, token: 6 })
  score += scoreField(tags, phrase, tokens, { exact: 44, startsWith: 26, includes: 16, token: 6 })
  score += scoreField(metadata, phrase, tokens, { exact: 16, startsWith: 10, includes: 8, token: 3 })
  score += Math.min(popularity, 80)

  return score
}

function compareDatesDesc(a: any, b: any) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
}

function compareAssets(a: any, b: any, sort: SearchSort, query: string) {
  const relevanceA = scoreAsset(a, query)
  const relevanceB = scoreAsset(b, query)
  const popularityA = (Number(a?._count?.purchases || 0) * 3) + Number(a?._count?.downloadEvents || 0)
  const popularityB = (Number(b?._count?.purchases || 0) * 3) + Number(b?._count?.downloadEvents || 0)

  if (sort === 'price_asc') {
    const byPrice = Number(a.priceCents || 0) - Number(b.priceCents || 0)
    if (byPrice) return byPrice
    if (query) {
      const byRelevance = relevanceB - relevanceA
      if (byRelevance) return byRelevance
    }
    return compareDatesDesc(a, b)
  }

  if (sort === 'price_desc') {
    const byPrice = Number(b.priceCents || 0) - Number(a.priceCents || 0)
    if (byPrice) return byPrice
    if (query) {
      const byRelevance = relevanceB - relevanceA
      if (byRelevance) return byRelevance
    }
    return compareDatesDesc(a, b)
  }

  if (sort === 'popular') {
    const byPopularity = popularityB - popularityA
    if (byPopularity) return byPopularity
    if (query) {
      const byRelevance = relevanceB - relevanceA
      if (byRelevance) return byRelevance
    }
    return compareDatesDesc(a, b)
  }

  if (sort === 'relevance') {
    const byRelevance = relevanceB - relevanceA
    if (byRelevance) return byRelevance
    const byPopularity = popularityB - popularityA
    if (byPopularity) return byPopularity
    return compareDatesDesc(a, b)
  }

  const byDate = compareDatesDesc(a, b)
  if (byDate) return byDate
  if (query) {
    const byRelevance = relevanceB - relevanceA
    if (byRelevance) return byRelevance
  }
  return popularityB - popularityA
}

function facetItemsFromMap(map: Map<string, SearchFacetItem>, take = 12) {
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, take)
}

function buildFacets(items: any[]): SearchAssetsResult['facets'] {
  const categories = new Map<string, SearchFacetItem>()
  const kinds = new Map<string, SearchFacetItem>()
  const vendors = new Map<string, SearchFacetItem>()
  const tags = new Map<string, SearchFacetItem>()

  for (const asset of items) {
    if (asset.category?.id && asset.category?.name) {
      const key = String(asset.category.id)
      const existing = categories.get(key) || { value: key, label: String(asset.category.name), count: 0 }
      existing.count += 1
      categories.set(key, existing)
    }

    if (asset.kind) {
      const key = String(asset.kind)
      const existing = kinds.get(key) || { value: key, label: key.replace(/_/g, ' '), count: 0 }
      existing.count += 1
      kinds.set(key, existing)
    }

    if (asset.vendor?.id && (asset.vendor?.displayName || asset.vendor?.slug)) {
      const key = String(asset.vendor.id)
      const existing = vendors.get(key) || { value: key, label: String(asset.vendor.displayName || asset.vendor.slug), count: 0 }
      existing.count += 1
      vendors.set(key, existing)
    }

    for (const link of Array.isArray(asset.tagLinks) ? asset.tagLinks : []) {
      if (!link?.tag?.slug || !link?.tag?.name) continue
      const key = String(link.tag.slug)
      const existing = tags.get(key) || { value: key, label: String(link.tag.name), count: 0 }
      existing.count += 1
      tags.set(key, existing)
    }
  }

  return {
    categories: facetItemsFromMap(categories),
    kinds: facetItemsFromMap(kinds),
    vendors: facetItemsFromMap(vendors),
    tags: facetItemsFromMap(tags),
  }
}

export function normalizeSearchSort(value: string | null | undefined, hasQuery = false): SearchSort {
  if (value === 'relevance' || value === 'price_asc' || value === 'price_desc' || value === 'popular') return value
  return hasQuery ? 'relevance' : 'newest'
}

export async function searchAssets(input: {
  siteId: string
  q?: string
  categoryId?: string
  kind?: string
  tag?: string
  vendorId?: string
  min?: number
  max?: number
  sort?: SearchSort
  limit?: number
}): Promise<SearchAssetsResult> {
  const query = String(input.q || '').trim()
  const sort = normalizeSearchSort(input.sort, Boolean(query))
  const where = {
    siteId: input.siteId,
    status: 'APPROVED' as const,
    downloadsDisabled: false,
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.kind ? { kind: input.kind as any } : {}),
    ...(input.tag ? { tagLinks: { some: { tag: { slug: input.tag } } } } : {}),
    ...(input.vendorId ? { vendorId: input.vendorId } : {}),
    ...((input.min || input.max) ? { priceCents: { ...(input.min ? { gte: input.min } : {}), ...(input.max ? { lte: input.max } : {}) } } : {}),
    ...(query ? {
      OR: [
        { title: { contains: query, mode: 'insensitive' as const } },
        { shortDescription: { contains: query, mode: 'insensitive' as const } },
        { description: { contains: query, mode: 'insensitive' as const } },
        { vendor: { is: { displayName: { contains: query, mode: 'insensitive' as const } } } },
        { vendor: { is: { slug: { contains: query, mode: 'insensitive' as const } } } },
        { category: { is: { name: { contains: query, mode: 'insensitive' as const } } } },
        { tagLinks: { some: { tag: { OR: [{ name: { contains: query, mode: 'insensitive' as const } }, { slug: { contains: query, mode: 'insensitive' as const } }] } } } },
        { metadataEntries: { some: { valueText: { contains: query, mode: 'insensitive' as const } } } },
      ],
    } : {}),
  }

  const candidates = await prisma.asset.findMany({
    where,
    include: {
      vendor: true,
      category: true,
      tagLinks: { include: { tag: true } },
      metadataEntries: { select: { valueText: true } },
      _count: { select: { purchases: true, downloadEvents: true } },
    },
    take: query ? 200 : 150,
  })

  const sorted = [...candidates].sort((a, b) => compareAssets(a, b, sort, query))
  const facets = buildFacets(sorted)
  const limit = Math.max(Math.min(Number(input.limit || 60), 120), 1)

  return {
    items: sorted.slice(0, limit),
    total: sorted.length,
    facets,
  }
}
