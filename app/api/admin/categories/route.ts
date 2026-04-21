import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { categorySchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { parseJsonValue, slugify } from '@/lib/utils'
import { getLicenseTemplates } from '@/lib/settings'
import { withRedirectAuth } from '@/lib/route-auth'

async function uniqueCategorySlug(siteId: string, desired: string) {
  const base = slugify(desired) || `category-${Date.now()}`
  let attempt = base, suffix = 2
  while (await prisma.category.findUnique({ where: { siteId_slug: { siteId, slug: attempt } }, select: { id: true } })) { attempt = `${base}-${suffix}`; suffix += 1 }
  return attempt
}

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const body = await req.formData()
  const parsed = categorySchema.safeParse({ name: body.get('name')?.toString() || '', slug: body.get('slug')?.toString() || '', description: body.get('description')?.toString() || '', parentId: body.get('parentId')?.toString() || null, groupId: body.get('groupId')?.toString() || null, sortOrder: body.get('sortOrder')?.toString() || '0', isActive: body.get('isActive')?.toString() === 'on', icon: body.get('icon')?.toString() || '', bannerUrl: body.get('bannerUrl')?.toString() || '', metadataSchema: body.get('metadataSchema')?.toString() || '', allowedPreviewTypes: body.get('allowedPreviewTypes')?.toString() || '', allowedFileTypes: body.get('allowedFileTypes')?.toString() || '', allowedLicenseTypes: body.get('allowedLicenseTypes')?.toString() || '', defaultLicenseKey: body.get('defaultLicenseKey')?.toString() || '', taxCode: body.get('taxCode')?.toString() || '', taxBehavior: body.get('taxBehavior')?.toString() || 'exclusive', featured: body.get('featured')?.toString() === 'on' })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/categories', req.url), { status: 303 })
  const slug = await uniqueCategorySlug(site.id, parsed.data.slug)
  const groupId = parsed.data.groupId ? (await prisma.categoryGroup.findFirst({ where: { id: parsed.data.groupId, siteId: site.id } }))?.id : undefined
  const parentId = parsed.data.parentId ? (await prisma.category.findFirst({ where: { id: parsed.data.parentId, siteId: site.id } }))?.id : undefined
  const licenseKeys = new Set(getLicenseTemplates(site.settings).map((item) => item.key))
  const defaultLicenseKey = parsed.data.defaultLicenseKey && licenseKeys.has(parsed.data.defaultLicenseKey) ? parsed.data.defaultLicenseKey : undefined
  const category = await prisma.category.create({ data: { siteId: site.id, name: parsed.data.name, slug, description: parsed.data.description || undefined, parentId, groupId, sortOrder: parsed.data.sortOrder, isActive: parsed.data.isActive, icon: parsed.data.icon || undefined, bannerUrl: parsed.data.bannerUrl || undefined, metadataSchema: parseJsonValue(parsed.data.metadataSchema, null) as any, allowedPreviewTypes: parseJsonValue(parsed.data.allowedPreviewTypes, null) as any, allowedFileTypes: parseJsonValue(parsed.data.allowedFileTypes, null) as any, allowedLicenseTypes: parseJsonValue(parsed.data.allowedLicenseTypes, null) as any, defaultLicenseKey, taxCode: parsed.data.taxCode || undefined, taxBehavior: parsed.data.taxBehavior || undefined, featured: parsed.data.featured } })
  await prisma.siteCategoryVisibility.upsert({ where: { siteId_categoryId: { siteId: site.id, categoryId: category.id } }, update: { enabled: parsed.data.isActive, sortOrder: parsed.data.sortOrder, featured: parsed.data.featured }, create: { siteId: site.id, categoryId: category.id, enabled: parsed.data.isActive, sortOrder: parsed.data.sortOrder, featured: parsed.data.featured } })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'category', entityId: category.id, action: 'category.created', details: { name: category.name, slug: category.slug, groupId: groupId || null, defaultLicenseKey: defaultLicenseKey || null } })
  return NextResponse.redirect(new URL('/admin/categories', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
