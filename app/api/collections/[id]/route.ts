import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { withJsonAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

export const POST = withJsonAuth(async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  const body = await req.json().catch(() => ({}))
  const action = String(body?._action || 'update')
  const collection = await prisma.collection.findFirst({ where: { id, userId: user.id, siteId: site.id } })
  if (!collection) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 })
  if (action === 'delete') {
    if (collection.isDefault) return NextResponse.json({ error: 'Default collection cannot be deleted.' }, { status: 400 })
    await prisma.collection.delete({ where: { id: collection.id } })
    return NextResponse.json({ ok: true })
  }
  const name = String(body?.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  const updated = await prisma.collection.update({ where: { id: collection.id }, data: { name } })
  return NextResponse.json({ ok: true, collection: updated })
})
