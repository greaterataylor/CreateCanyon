//app/api/admin/categories/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { categorySchema } from '@/lib/validation'

export async function POST(req: NextRequest) {
  await requireAdmin()
  const body = await req.formData()
  const name = body.get('name')?.toString() || ''
  const slug = body.get('slug')?.toString() || ''
  const parsed = categorySchema.safeParse({ name, slug })
  if (!parsed.success) return NextResponse.redirect(new URL('/admin/categories', process.env.NEXT_PUBLIC_BASE_URL))
  const site = await prisma.site.findUnique({ where: { slug: process.env.SITE_SLUG || 'CreateCanyon' } })
  if (!site) return NextResponse.redirect(new URL('/admin/categories', process.env.NEXT_PUBLIC_BASE_URL))
  await prisma.category.create({ data: { name, slug, siteId: site.id } })
  return NextResponse.redirect(new URL('/admin/categories', process.env.NEXT_PUBLIC_BASE_URL))
}
