import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assetCreateSchema } from '@/lib/validation'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: user.id } })
  if (!vendor || vendor.status !== 'APPROVED') return NextResponse.json({ error: 'Not an approved vendor' }, { status: 403 })
  const body = await req.json()
  const parsed = assetCreateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { title, description, priceCents, currency, categoryId, previewType, previewKey, downloadKey } = parsed.data
  const site = await prisma.site.findUnique({ where: { slug: process.env.SITE_SLUG || 'CreateCanyon' } })
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 400 })
  const previewUrl = previewKey ? `${process.env.S3_PUBLIC_BASE_URL}/${previewKey}` : null
  await prisma.asset.create({
    data: {
      siteId: site.id,
      vendorId: vendor.id,
      categoryId,
      title,
      description,
      priceCents,
      currency,
      previewType,
      previewUrl,
      downloadKey,
      status: 'PENDING'
    }
  })
  return NextResponse.json({ ok: true })
}
