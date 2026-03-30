import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { vendorUpdateSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { withRedirectAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

export const POST = withRedirectAuth(async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const parsed = vendorUpdateSchema.safeParse({ status: (form.get('status') || '').toString(), moderationNotes: form.get('moderationNotes')?.toString() || '' })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/vendors', req.url), { status: 303 })
  const membership = await prisma.vendorSiteMembership.findFirst({ where: { id, siteId: site.id } })
  if (!membership) return NextResponse.redirect(new URL('/admin/vendors', req.url), { status: 303 })
  const now = new Date()
  await prisma.vendorSiteMembership.update({ where: { id: membership.id }, data: { status: parsed.data.status, moderationNotes: parsed.data.moderationNotes || undefined, approvedAt: parsed.data.status === 'APPROVED' ? now : membership.approvedAt, rejectedAt: parsed.data.status === 'REJECTED' ? now : membership.rejectedAt } })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'vendorMembership', entityId: membership.id, action: 'vendor.status.updated', details: parsed.data })
  return NextResponse.redirect(new URL('/admin/vendors', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
