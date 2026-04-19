import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { categoryGroupSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { slugify } from '@/lib/utils'
import { withRedirectAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

async function uniqueGroupSlug(siteId: string, desired: string, currentId: string) {
  const base = slugify(desired) || `group-${Date.now()}`
  let attempt = base
  let suffix = 2
  while (true) {
    const existing = await prisma.categoryGroup.findFirst({ where: { siteId, slug: attempt } })
    if (!existing || existing.id === currentId) return attempt
    attempt = `${base}-${suffix}`
    suffix += 1
  }
}

export const POST = withRedirectAuth(async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const group = await prisma.categoryGroup.findFirst({ where: { id, siteId: site.id } })
  if (!group) return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  const form = await req.formData()
  const action = form.get('_action')?.toString() || 'update'
  if (action === 'delete') {
    await prisma.category.updateMany({ where: { groupId: group.id, siteId: site.id }, data: { groupId: null } })
    await prisma.categoryGroup.delete({ where: { id: group.id } })
    await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'categoryGroup', entityId: group.id, action: 'category-group.deleted' })
    return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  }
  const parsed = categoryGroupSchema.safeParse({ name: form.get('name')?.toString() || '', slug: form.get('slug')?.toString() || '', sortOrder: form.get('sortOrder')?.toString() || '0' })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  const slug = await uniqueGroupSlug(site.id, parsed.data.slug, group.id)
  await prisma.categoryGroup.update({ where: { id: group.id }, data: { name: parsed.data.name, slug, sortOrder: parsed.data.sortOrder } })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'categoryGroup', entityId: group.id, action: 'category-group.updated', details: { slug } })
  return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
