import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { vendorUpdateSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { withRedirectAuth } from '@/lib/route-auth'

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const membershipIds = form.getAll('membershipIds').map((value) => String(value)).filter(Boolean)
  if (!membershipIds.length) return NextResponse.redirect(new URL('/admin/vendors', req.url), { status: 303 })
  const parsed = vendorUpdateSchema.safeParse({
    status: form.get('status')?.toString() || '',
    moderationNotes: form.get('moderationNotes')?.toString() || '',
  })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/vendors', req.url), { status: 303 })

  const memberships = await prisma.vendorSiteMembership.findMany({ where: { id: { in: membershipIds }, siteId: site.id } })
  const now = new Date()
  await Promise.all(memberships.map((membership: any) => prisma.vendorSiteMembership.update({
    where: { id: membership.id },
    data: {
      status: parsed.data.status,
      moderationNotes: parsed.data.moderationNotes || undefined,
      approvedAt: parsed.data.status === 'APPROVED' ? now : membership.approvedAt,
      rejectedAt: parsed.data.status === 'REJECTED' ? now : membership.rejectedAt,
    },
  })))
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'vendorMembership', entityId: membershipIds.join(','), action: 'vendor.bulk-status.updated', details: { ...parsed.data, membershipIds } })
  return NextResponse.redirect(new URL('/admin/vendors', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
