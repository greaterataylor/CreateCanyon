import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { currentUser, requireUser } from '@/lib/auth'
import { addAssetToCollection, isAssetSavedByUser, removeAssetFromUserCollections } from '@/lib/collections'
import { withJsonAuth } from '@/lib/route-auth'

export async function GET(req: NextRequest) {
  const site = await getActiveSiteForRequest(req)
  const assetId = req.nextUrl.searchParams.get('assetId')
  if (assetId) {
    const user = await currentUser()
    if (!user) return NextResponse.json({ signedIn: false, saved: false })
    const saved = await isAssetSavedByUser(user.id, site.id, assetId)
    return NextResponse.json({ signedIn: true, saved })
  }

  const ids = (req.nextUrl.searchParams.get('ids') || '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 50)
  if (!ids.length) return NextResponse.json([])
  const assets = await prisma.asset.findMany({
    where: { id: { in: ids }, siteId: site.id, status: 'APPROVED', downloadsDisabled: false },
    include: { vendor: true, category: true },
  })
  return NextResponse.json(assets)
}

export const POST = withJsonAuth(async function POST(req: NextRequest) {
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  const body = await req.json().catch(() => ({}))
  const assetId = String(body?.assetId || '').trim()
  if (!assetId) return NextResponse.json({ error: 'assetId is required.' }, { status: 400 })
  const collection = await addAssetToCollection({ userId: user.id, siteId: site.id, assetId, collectionId: body?.collectionId || null, collectionName: body?.collectionName || null })
  if (!collection) return NextResponse.json({ error: 'Unable to save asset.' }, { status: 400 })
  return NextResponse.json({ ok: true, saved: true, collectionId: collection.id })
})

export const DELETE = withJsonAuth(async function DELETE(req: NextRequest) {
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  const body = await req.json().catch(() => ({}))
  const assetId = String(body?.assetId || '').trim()
  if (!assetId) return NextResponse.json({ error: 'assetId is required.' }, { status: 400 })
  await removeAssetFromUserCollections(user.id, site.id, assetId)
  return NextResponse.json({ ok: true, saved: false })
})
