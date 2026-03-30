import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { categorySchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { parseJsonValue, slugify } from '@/lib/utils'
import { getLicenseTemplates } from '@/lib/settings'
import { withRedirectAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

async function uniqueCategorySlug(siteId: string, desired: string, currentId: string) {
  const base = slugify(desired) || `category-${Date.now()}`
  let attempt = base, suffix = 2
  while (true) {
    const existing = await prisma.category.findFirst({ where: { siteId, slug: attempt } })
    if (!existing || existing.id === currentId) return attempt
    attempt = `${base}-${suffix}`
    suffix += 1
  }
}

export const POST = withRedirectAuth(async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const action = form.get('_action')?.toString() || 'update'
  const category = await prisma.category.findFirst({ where: { id, siteId: site.id } })
  if (!category) return NextResponse.redirect(new URL('/admin/categories', req.url), { status: 303 })
  if (action === 'delete') {
    await prisma.$transaction([prisma.siteCategoryVisibility.deleteMany({ where: { categoryId: category.id, siteId: site.id } }), prisma.category.delete({ where: { id: category.id } })])
    await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'category', entityId: category.id, action: 'category.deleted' })
    return NextResponse.redirect(new URL('/admin/categories', req.url), { status: 303 })
  }
  const parsed = categorySchema.safeParse({ name: form.get('name')?.toString() || '', slug: form.get('slug')?.toString() || '', description: form.get('description')?.toString() || '', parentId: form.get('parentId')?.toString() || null, groupId: form.get('groupId')?.toString() || null, sortOrder: form.get('sortOrder')?.toString() || '0', isActive: form.get('isActive')?.toString() === 'on', icon: form.get('icon')?.toString() || '', bannerUrl: form.get('bannerUrl')?.toString() || '', metadataSchema: form.get('metadataSchema')?.toString() || '', allowedPreviewTypes: form.get('allowedPreviewTypes')?.toString() || '', allowedFileTypes: form.get('allowedFileTypes')?.toString() || '', allowedLicenseTypes: form.get('allowedLicenseTypes')?.toString() || '', defaultLicenseKey: form.get('defaultLicenseKey')?.toString() || '', taxCode: form.get('taxCode')?.toString() || '', taxBehavior: form.get('taxBehavior')?.toString() || 'exclusive', featured: form.get('featured')?.toString() === 'on' })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/categories', req.url), { status: 303 })
  const slug = await uniqueCategorySlug(site.id, parsed.data.slug, category.id)
  const groupId = parsed.data.groupId ? (await prisma.categoryGroup.findFirst({ where: { id: parsed.data.groupId, siteId: site.id } }))?.id : undefined
  const parentId = parsed.data.parentId ? (await prisma.category.findFirst({ where: { id: parsed.data.parentId, siteId: site.id } }))?.id : undefined
  const licenseKeys = new Set(getLicenseTemplates(site.settings).map((item) => item.key))
  const defaultLicenseKey = parsed.data.defaultLicenseKey && licenseKeys.has(parsed.data.defaultLicenseKey) ? parsed.data.defaultLicenseKey : undefined
  await prisma.category.update({ where: { id: category.id }, data: { name: parsed.data.name, slug, description: parsed.data.description || undefined, parentId, groupId, sortOrder: parsed.data.sortOrder, isActive: parsed.data.isActive, icon: parsed.data.icon || undefined, bannerUrl: parsed.data.bannerUrl || undefined, metadataSchema: parseJsonValue(parsed.data.metadataSchema, null) as any, allowedPreviewTypes: parseJsonValue(parsed.data.allowedPreviewTypes, null) as any, allowedFileTypes: parseJsonValue(parsed.data.allowedFileTypes, null) as any, allowedLicenseTypes: parseJsonValue(parsed.data.allowedLicenseTypes, null) as any, defaultLicenseKey, taxCode: parsed.data.taxCode || undefined, taxBehavior: parsed.data.taxBehavior || undefined, featured: parsed.data.featured } })
  await prisma.siteCategoryVisibility.upsert({ where: { siteId_categoryId: { siteId: site.id, categoryId: category.id } }, update: { enabled: parsed.data.isActive, sortOrder: parsed.data.sortOrder, featured: parsed.data.featured }, create: { siteId: site.id, categoryId: category.id, enabled: parsed.data.isActive, sortOrder: parsed.data.sortOrder, featured: parsed.data.featured } })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'category', entityId: category.id, action: 'category.updated', details: { slug, isActive: parsed.data.isActive, groupId: groupId || null, defaultLicenseKey: defaultLicenseKey || null } })
  return NextResponse.redirect(new URL('/admin/categories', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
