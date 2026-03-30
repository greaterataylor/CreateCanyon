import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { createAuditLog } from '@/lib/audit'
import { slugify } from '@/lib/utils'
import { withRedirectAuth } from '@/lib/route-auth'

async function uniqueVendorSlug(baseValue: string) {
  const base = slugify(baseValue) || `vendor-${Date.now()}`
  let attempt = base, suffix = 2
  while (await prisma.vendor.findUnique({ where: { slug: attempt }, select: { id: true } })) { attempt = `${base}-${suffix}`; suffix += 1 }
  return attempt
}

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const user = await requireUser(); const site = await getActiveSiteForRequest(req)
  const vendor = user.vendor || await prisma.vendor.create({ data: { userId: user.id, displayName: user.name || user.email.split('@')[0], slug: await uniqueVendorSlug(user.name || user.email.split('@')[0]), bio: '' } })
  const existingMembership = await prisma.vendorSiteMembership.findUnique({ where: { vendorId_siteId: { vendorId: vendor.id, siteId: site.id } } })
  if (!existingMembership) {
    const storefrontSlugBase = slugify(`${vendor.slug}-${site.slug}`)
    let storefrontSlug = storefrontSlugBase || `${vendor.slug}-${site.slug.toLowerCase()}`
    let suffix = 2
    while (await prisma.vendorSiteMembership.findFirst({ where: { siteId: site.id, storefrontSlug } })) { storefrontSlug = `${storefrontSlugBase}-${suffix}`; suffix += 1 }
    const membership = await prisma.vendorSiteMembership.create({ data: { vendorId: vendor.id, siteId: site.id, storefrontName: vendor.displayName, storefrontSlug, payoutEmail: user.email, status: 'PENDING' } })
    await createAuditLog({ actorUserId: user.id, siteId: site.id, entityType: 'vendorMembership', entityId: membership.id, action: 'vendor.applied', details: { vendorId: vendor.id } })
  }
  return NextResponse.redirect(new URL('/dashboard', req.url), { status: 303 })
})
