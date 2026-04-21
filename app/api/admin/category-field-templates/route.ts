import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { categoryFieldTemplateSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { parseJsonValue } from '@/lib/utils'
import { withRedirectAuth } from '@/lib/route-auth'

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const site = await getActiveSiteForRequest(req)
  const admin = await requireAdminForSite(site.id)
  const form = await req.formData()
  const parsed = categoryFieldTemplateSchema.safeParse({
    categoryId: form.get('categoryId')?.toString() || '',
    name: form.get('name')?.toString() || '',
    label: form.get('label')?.toString() || '',
    fieldType: form.get('fieldType')?.toString() || '',
    required: form.get('required')?.toString() === 'on',
    sortOrder: form.get('sortOrder')?.toString() || '0',
    options: form.get('options')?.toString() || '',
  })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  const category = await prisma.category.findFirst({ where: { id: parsed.data.categoryId, siteId: site.id } })
  if (!category) return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
  const template = await prisma.categoryFieldTemplate.create({
    data: {
      categoryId: category.id,
      name: parsed.data.name,
      label: parsed.data.label,
      fieldType: parsed.data.fieldType,
      required: parsed.data.required,
      sortOrder: parsed.data.sortOrder,
      options: parseJsonValue(parsed.data.options, null) as any,
    },
  })
  await createAuditLog({ actorUserId: admin.id, siteId: site.id, entityType: 'categoryFieldTemplate', entityId: template.id, action: 'category-field-template.created', details: { categoryId: category.id, name: template.name } })
  return NextResponse.redirect(new URL('/admin/taxonomy', req.url), { status: 303 })
}, { forbiddenPath: '/dashboard' })
