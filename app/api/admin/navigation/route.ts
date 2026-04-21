import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { siteNavigationItemSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { withRedirectAuth } from '@/lib/route-auth'

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const parsed = siteNavigationItemSchema.safeParse({
    label: form.get('label')?.toString() || '',
    href: form.get('href')?.toString() || '',
    sortOrder: form.get('sortOrder')?.toString() || '0',
    isVisible: form.get('isVisible')?.toString() === 'on',
  })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/site', req.url), { status: 303 })

  const item = await prisma.siteNavigationItem.create({
    data: {
      siteId: site.id,
      label: parsed.data.label,
      href: parsed.data.href,
      sortOrder: parsed.data.sortOrder,
      isVisible: parsed.data.isVisible,
    },
  })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'site_navigation', entityId: item.id, action: 'site-navigation.created', details: parsed.data })
  return NextResponse.redirect(new URL('/admin/site', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
