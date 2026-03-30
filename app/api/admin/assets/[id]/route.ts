import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { assetStatusSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { withRedirectAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

export const POST = withRedirectAuth(async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const parsed = assetStatusSchema.safeParse({ status: (form.get('status') || '').toString(), rejectionReason: form.get('rejectionReason')?.toString() || '' })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/assets', req.url), { status: 303 })
  const asset = await prisma.asset.findFirst({ where: { id, siteId: site.id } })
  if (!asset) return NextResponse.redirect(new URL('/admin/assets', req.url), { status: 303 })
  await prisma.asset.update({ where: { id: asset.id }, data: { status: parsed.data.status, rejectionReason: parsed.data.rejectionReason || undefined } })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'asset', entityId: asset.id, action: 'asset.status.updated', details: parsed.data })
  return NextResponse.redirect(new URL('/admin/assets', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
