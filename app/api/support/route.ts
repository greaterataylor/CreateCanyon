import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { supportCaseSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { createSupportCase } from '@/lib/support'
import { withRedirectAuth } from '@/lib/route-auth'

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  const form = await req.formData()
  const parsed = supportCaseSchema.safeParse({
    type: form.get('type')?.toString() || '',
    assetId: form.get('assetId')?.toString() || '',
    orderId: form.get('orderId')?.toString() || '',
    message: form.get('message')?.toString() || '',
  })
  if (!parsed.success) return NextResponse.redirect(new URL(`/assets/${form.get('assetId')?.toString() || ''}?support=invalid`, req.url), { status: 303 })
  const asset = await prisma.asset.findFirst({ where: { id: parsed.data.assetId, siteId: site.id }, include: { vendor: true } })
  if (!asset) return NextResponse.redirect(new URL('/', req.url), { status: 303 })
  const purchase = parsed.data.orderId
    ? await prisma.purchase.findFirst({ where: { userId: user.id, orderId: parsed.data.orderId, assetId: asset.id, siteId: site.id } })
    : await prisma.purchase.findFirst({ where: { userId: user.id, assetId: asset.id, siteId: site.id } })
  if ((parsed.data.type === 'refund' || parsed.data.type === 'dispute') && !purchase) {
    return NextResponse.redirect(new URL(`/assets/${asset.id}?support=not-eligible`, req.url), { status: 303 })
  }

  const supportCase = await createSupportCase({
    siteId: site.id,
    reporterUserId: user.id,
    assetId: asset.id,
    orderId: purchase?.orderId || parsed.data.orderId || null,
    vendorId: asset.vendorId,
    type: parsed.data.type,
    message: parsed.data.message,
  })

  await createAuditLog({
    actorUserId: user.id,
    siteId: site.id,
    entityType: 'support_case',
    entityId: supportCase?.id || randomUUID(),
    action: `support.${parsed.data.type}.created`,
    details: {
      type: parsed.data.type,
      status: 'open',
      assetId: asset.id,
      orderId: purchase?.orderId || parsed.data.orderId || null,
      message: parsed.data.message,
    },
  })

  return NextResponse.redirect(new URL(`/assets/${asset.id}?support=sent`, req.url), { status: 303 })
})
