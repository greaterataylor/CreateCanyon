import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { siteSettingsSchema } from '@/lib/validation'
import { parseJsonValue } from '@/lib/utils'
import { createAuditLog } from '@/lib/audit'
import { withRedirectAuth } from '@/lib/route-auth'

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const parsed = siteSettingsSchema.safeParse({ name: form.get('name')?.toString() || '', domain: form.get('domain')?.toString() || '', logoUrl: form.get('logoUrl')?.toString() || '', seoTitle: form.get('seoTitle')?.toString() || '', seoDescription: form.get('seoDescription')?.toString() || '', theme: form.get('theme')?.toString() || '', settings: form.get('settings')?.toString() || '' })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/site', req.url), { status: 303 })
  await prisma.site.update({ where: { id: site.id }, data: { name: parsed.data.name, domain: parsed.data.domain || null, logoUrl: parsed.data.logoUrl || null, seoTitle: parsed.data.seoTitle || null, seoDescription: parsed.data.seoDescription || null, theme: parseJsonValue(parsed.data.theme, null) as any, settings: parseJsonValue(parsed.data.settings, null) as any } })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'site', entityId: site.id, action: 'site.settings.updated', details: { name: parsed.data.name, domain: parsed.data.domain || null } })
  return NextResponse.redirect(new URL('/admin/site', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
