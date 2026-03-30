import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { assetStatusSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { withRedirectAuth } from '@/lib/route-auth'

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const assetIds = form.getAll('assetIds').map((value) => String(value)).filter(Boolean)
  if (!assetIds.length) return NextResponse.redirect(new URL('/admin/assets', req.url), { status: 303 })
  const parsed = assetStatusSchema.safeParse({
    status: form.get('status')?.toString() || '',
    rejectionReason: form.get('rejectionReason')?.toString() || '',
  })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/assets', req.url), { status: 303 })

  await prisma.asset.updateMany({ where: { id: { in: assetIds }, siteId: site.id }, data: { status: parsed.data.status, rejectionReason: parsed.data.rejectionReason || undefined } })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'asset', entityId: assetIds.join(','), action: 'asset.bulk-status.updated', details: { ...parsed.data, assetIds } })
  return NextResponse.redirect(new URL('/admin/assets', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
