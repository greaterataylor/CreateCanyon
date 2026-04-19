import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { categoryRuleSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { parseJsonValue } from '@/lib/utils'
import { withRedirectAuth } from '@/lib/route-auth'

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const parsed = categoryRuleSchema.safeParse({
    categoryId: form.get('categoryId')?.toString() || '',
    key: form.get('key')?.toString() || '',
    value: form.get('value')?.toString() || '',
  })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  const category = await prisma.category.findFirst({ where: { id: parsed.data.categoryId, siteId: site.id } })
  if (!category) return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  const rule = await prisma.categoryRule.upsert({
    where: { categoryId_key: { categoryId: category.id, key: parsed.data.key } },
    update: { value: parseJsonValue(parsed.data.value, null) as any },
    create: { categoryId: category.id, key: parsed.data.key, value: parseJsonValue(parsed.data.value, null) as any },
  })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'categoryRule', entityId: rule.id, action: 'category-rule.saved', details: { categoryId: category.id, key: rule.key } })
  return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
