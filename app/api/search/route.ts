import { NextRequest, NextResponse } from 'next/server'
import { normalizeSearchSort, searchAssets } from '@/lib/search'
import { getActiveSiteForRequest } from '@/lib/site'

function truthy(value: string | null) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export async function GET(req: NextRequest) {
  const site = await getActiveSiteForRequest(req)
  const q = req.nextUrl.searchParams.get('q') || undefined
  const categoryId = req.nextUrl.searchParams.get('category') || undefined
  const kind = req.nextUrl.searchParams.get('kind') || undefined
  const tag = req.nextUrl.searchParams.get('tag') || undefined
  const vendorId = req.nextUrl.searchParams.get('vendor') || req.nextUrl.searchParams.get('vendorId') || undefined
  const min = Number(req.nextUrl.searchParams.get('min') || 0) || undefined
  const max = Number(req.nextUrl.searchParams.get('max') || 0) || undefined
  const limit = Number(req.nextUrl.searchParams.get('limit') || 0) || undefined
  const sort = normalizeSearchSort(req.nextUrl.searchParams.get('sort') || undefined, Boolean(q))
  const includeMeta = truthy(req.nextUrl.searchParams.get('includeMeta'))

  const result = await searchAssets({ siteId: site.id, q, categoryId, kind, tag, vendorId, min, max, limit, sort })
  return NextResponse.json(includeMeta ? result : result.items)
}
