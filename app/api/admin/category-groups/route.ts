import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { categoryGroupSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { slugify } from '@/lib/utils'
import { withRedirectAuth } from '@/lib/route-auth'

async function uniqueGroupSlug(siteId: string, desired: string, currentId?: string) {
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

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const parsed = categoryGroupSchema.safeParse({
    name: form.get('name')?.toString() || '',
    slug: form.get('slug')?.toString() || '',
    sortOrder: form.get('sortOrder')?.toString() || '0',
  })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  const slug = await uniqueGroupSlug(site.id, parsed.data.slug)
  const group = await prisma.categoryGroup.create({ data: { siteId: site.id, name: parsed.data.name, slug, sortOrder: parsed.data.sortOrder } })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'categoryGroup', entityId: group.id, action: 'category-group.created', details: { name: group.name, slug } })
  return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
