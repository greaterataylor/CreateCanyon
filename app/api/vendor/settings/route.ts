import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { vendorStoreSchema } from '@/lib/validation'
import { createAuditLog } from '@/lib/audit'
import { slugify } from '@/lib/utils'
import { withRedirectAuth } from '@/lib/route-auth'

async function ensureUniqueStorefrontSlug(siteId: string, desired: string, membershipId?: string) {
  const base = slugify(desired) || `store-${Date.now()}`
  let attempt = base, suffix = 2
  while (true) { const existing = await prisma.vendorSiteMembership.findFirst({ where: { siteId, storefrontSlug: attempt } }); if (!existing || existing.id === membershipId) return attempt; attempt = `${base}-${suffix}`; suffix += 1 }
}
async function ensureUniqueVendorSlug(desired: string, vendorId?: string) {
  const base = slugify(desired) || `vendor-${Date.now()}`
  let attempt = base, suffix = 2
  while (true) { const existing = await prisma.vendor.findFirst({ where: { slug: attempt } }); if (!existing || existing.id === vendorId) return attempt; attempt = `${base}-${suffix}`; suffix += 1 }
}

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const user = await requireUser(); const site = await getActiveSiteForRequest(req)
  if (!user.vendor) return NextResponse.redirect(new URL('/dashboard', req.url), { status: 303 })
  const form = await req.formData()
  const parsed = vendorStoreSchema.safeParse({ displayName: form.get('displayName')?.toString() || '', bio: form.get('bio')?.toString() || '', storefrontName: form.get('storefrontName')?.toString() || '', storefrontSlug: form.get('storefrontSlug')?.toString() || '', headline: form.get('headline')?.toString() || '', payoutEmail: form.get('payoutEmail')?.toString() || '', legalName: form.get('legalName')?.toString() || '', taxCountry: form.get('taxCountry')?.toString() || '' })
  if (!parsed.success) return NextResponse.redirect(new URL('/dashboard/store', req.url), { status: 303 })
  const membership = await prisma.vendorSiteMembership.findUnique({ where: { vendorId_siteId: { vendorId: user.vendor.id, siteId: site.id } } })
  const vendorSlug = await ensureUniqueVendorSlug(parsed.data.displayName, user.vendor.id)
  const storefrontSlug = await ensureUniqueStorefrontSlug(site.id, parsed.data.storefrontSlug, membership?.id)
  await prisma.$transaction(async (tx: any) => {
    await tx.vendor.update({ where: { id: user.vendor!.id }, data: { displayName: parsed.data.displayName, slug: vendorSlug, bio: parsed.data.bio || undefined } })
    if (membership) {
      await tx.vendorSiteMembership.update({ where: { id: membership.id }, data: { storefrontName: parsed.data.storefrontName || parsed.data.displayName, storefrontSlug, headline: parsed.data.headline || undefined, payoutEmail: parsed.data.payoutEmail || undefined, legalName: parsed.data.legalName || undefined, taxCountry: parsed.data.taxCountry || undefined } })
    } else {
      await tx.vendorSiteMembership.create({ data: { vendorId: user.vendor!.id, siteId: site.id, status: 'PENDING', storefrontName: parsed.data.storefrontName || parsed.data.displayName, storefrontSlug, headline: parsed.data.headline || undefined, payoutEmail: parsed.data.payoutEmail || undefined, legalName: parsed.data.legalName || undefined, taxCountry: parsed.data.taxCountry || undefined } })
    }
  })
  await createAuditLog({ actorUserId: user.id, siteId: site.id, entityType: 'vendor', entityId: user.vendor.id, action: 'vendor.settings.updated', details: { storefrontSlug } })
  return NextResponse.redirect(new URL('/dashboard/store', req.url), { status: 303 })
})
