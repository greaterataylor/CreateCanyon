import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { withJsonAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string; assetId: string }>

export const DELETE = withJsonAuth(async function DELETE(req: NextRequest, { params }: { params: Params }) {
  const { id, assetId } = await params
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  const collection = await prisma.collection.findFirst({ where: { id, userId: user.id, siteId: site.id } })
  if (!collection) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 })
  await prisma.collectionItem.deleteMany({ where: { collectionId: collection.id, assetId } })
  return NextResponse.json({ ok: true })
})
