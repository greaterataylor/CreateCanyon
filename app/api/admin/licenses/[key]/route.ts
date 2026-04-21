import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { licenseTemplateSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { deleteLicenseTemplate, upsertLicenseTemplate } from '@/lib/settings'
import { withRedirectAuth } from '@/lib/route-auth'

type Params = Promise<{ key: string }>

export const POST = withRedirectAuth(async function POST(req: NextRequest, { params }: { params: Params }) {
  const { key } = await params
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const action = form.get('_action')?.toString() || 'update'
  if (action === 'delete') {
    const updatedSettings = deleteLicenseTemplate(site.settings, key)
    await prisma.site.update({ where: { id: site.id }, data: { settings: updatedSettings as any } })
    await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'siteLicenseTemplate', entityId: key, action: 'license-template.deleted' })
    return NextResponse.redirect(new URL('/admin/licenses', req.url), { status: 303 })
  }
  const parsed = licenseTemplateSchema.safeParse({
    key,
    name: form.get('name')?.toString() || '',
    standardLabel: form.get('standardLabel')?.toString() || 'Standard',
    standardText: form.get('standardText')?.toString() || '',
    extendedLabel: form.get('extendedLabel')?.toString() || 'Extended',
    extendedText: form.get('extendedText')?.toString() || '',
    extendedMultiplier: form.get('extendedMultiplier')?.toString() || '2',
    isDefault: form.get('isDefault')?.toString() === 'on',
  })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/licenses', req.url), { status: 303 })
  const updatedSettings = upsertLicenseTemplate(site.settings, parsed.data)
  await prisma.site.update({ where: { id: site.id }, data: { settings: updatedSettings as any } })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'siteLicenseTemplate', entityId: key, action: 'license-template.updated', details: { name: parsed.data.name, isDefault: parsed.data.isDefault } })
  return NextResponse.redirect(new URL('/admin/licenses', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
