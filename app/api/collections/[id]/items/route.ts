import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { addAssetToCollection } from '@/lib/collections'
import { getActiveSiteForRequest } from '@/lib/site'
import { withJsonAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

export const POST = withJsonAuth(async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  const body = await req.json().catch(() => ({}))
  const assetId = String(body?.assetId || '').trim()
  if (!assetId) return NextResponse.json({ error: 'assetId is required.' }, { status: 400 })
  const collection = await addAssetToCollection({ userId: user.id, siteId: site.id, assetId, collectionId: id })
  if (!collection) return NextResponse.json({ error: 'Unable to save asset.' }, { status: 400 })
  return NextResponse.json({ ok: true, collectionId: collection.id })
})
