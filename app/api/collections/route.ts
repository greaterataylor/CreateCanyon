import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { ensureDefaultCollection, getUserCollections } from '@/lib/collections'
import { getActiveSiteForRequest } from '@/lib/site'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/utils'
import { withJsonAuth } from '@/lib/route-auth'

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    const site = await getActiveSiteForRequest(req)
    await ensureDefaultCollection(user.id, site.id)
    const collections = await getUserCollections(user.id, site.id)
    return NextResponse.json({ signedIn: true, collections })
  } catch {
    return NextResponse.json({ signedIn: false, collections: [] }, { status: 401 })
  }
}

export const POST = withJsonAuth(async function POST(req: NextRequest) {
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  const body = await req.json().catch(() => ({}))
  const name = String(body?.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  const slugBase = slugify(name) || `collection-${Date.now()}`
  let slug = slugBase
  let suffix = 2
  while (await prisma.collection.findFirst({ where: { userId: user.id, siteId: site.id, slug } }).catch(() => null)) {
    slug = `${slugBase}-${suffix++}`
  }
  const collection = await prisma.collection.create({ data: { userId: user.id, siteId: site.id, name, slug, isDefault: false } })
  return NextResponse.json({ ok: true, collection })
})
