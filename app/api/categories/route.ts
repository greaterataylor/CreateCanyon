import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { serializeCategoryForClient } from '@/lib/taxonomy'

export async function GET() {
  const site = await getActiveSite()
  const categories = await prisma.category.findMany({
    where: {
      siteId: site.id,
      isActive: true,
      OR: [
        { visibilities: { none: {} } },
        { visibilities: { some: { siteId: site.id, enabled: true } } },
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      fieldTemplates: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      rules: { orderBy: [{ key: 'asc' }] },
      visibilities: { where: { siteId: site.id }, take: 1 },
    },
  })
  return NextResponse.json(categories.map(serializeCategoryForClient))
}
