//app/api/categories/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const slug = process.env.SITE_SLUG || 'CreateCanyon'
  const site = await prisma.site.findUnique({ where: { slug } })
  if (!site) return NextResponse.json([])
  const categories = await prisma.category.findMany({ where: { siteId: site.id }, orderBy: { name: 'asc' } })
  return NextResponse.json(categories)
}
