import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { categoryRuleSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { parseJsonValue } from '@/lib/utils'
import { withRedirectAuth } from '@/lib/route-auth'

type Params = Promise<{ id: string }>

export const POST = withRedirectAuth(async function POST(req: NextRequest, { params }: { params: Params }) {
  const { id } = await params
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const rule = await prisma.categoryRule.findFirst({ where: { id, category: { siteId: site.id } } })
  if (!rule) return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  const form = await req.formData()
  const action = form.get('_action')?.toString() || 'update'
  if (action === 'delete') {
    await prisma.categoryRule.delete({ where: { id: rule.id } })
    await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'categoryRule', entityId: rule.id, action: 'category-rule.deleted' })
    return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  }
  const parsed = categoryRuleSchema.safeParse({ categoryId: form.get('categoryId')?.toString() || '', key: form.get('key')?.toString() || '', value: form.get('value')?.toString() || '' })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  const category = await prisma.category.findFirst({ where: { id: parsed.data.categoryId, siteId: site.id } })
  if (!category) return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  await prisma.categoryRule.update({ where: { id: rule.id }, data: { categoryId: category.id, key: parsed.data.key, value: parseJsonValue(parsed.data.value, null) as any } })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'categoryRule', entityId: rule.id, action: 'category-rule.updated', details: { categoryId: category.id, key: parsed.data.key } })
  return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
