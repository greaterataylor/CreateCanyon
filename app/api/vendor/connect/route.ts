import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSiteForRequest } from '@/lib/site'
import { getStripe } from '@/lib/stripe'
import { withRedirectAuth } from '@/lib/route-auth'

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  if (!user.vendor) return NextResponse.redirect(new URL('/dashboard/store?connect=missing-vendor', req.url), { status: 303 })
  const membership = await prisma.vendorSiteMembership.findUnique({ where: { vendorId_siteId: { vendorId: user.vendor.id, siteId: site.id } } })
  if (!membership) return NextResponse.redirect(new URL('/dashboard/store?connect=missing-membership', req.url), { status: 303 })
  const action = (await req.formData()).get('action')?.toString() || 'onboard'
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.redirect(new URL('/dashboard/store?connect=missing-config', req.url), { status: 303 })
  const stripe = getStripe()
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin
  let accountId = membership.stripeAccountId || null
  let account: any = null

  if (!accountId) {
    account = await stripe.accounts.create({
      type: 'express',
      country: (membership.taxCountry || process.env.STRIPE_CONNECT_DEFAULT_COUNTRY || 'US').slice(0, 2).toUpperCase(),
      email: membership.payoutEmail || user.email,
      business_type: 'individual',
      metadata: { siteId: site.id, vendorId: user.vendor.id, membershipId: membership.id },
    })
    accountId = account.id
  } else {
    account = await stripe.accounts.retrieve(accountId)
  }

  await prisma.vendorSiteMembership.update({
    where: { id: membership.id },
    data: {
      stripeAccountId: account.id,
      stripeAccountStatus: String(account.requirements?.disabled_reason ? 'restricted' : account.details_submitted ? 'active' : 'pending'),
      stripeChargesEnabled: Boolean(account.charges_enabled),
      stripePayoutsEnabled: Boolean(account.payouts_enabled),
      stripeDetailsSubmitted: Boolean(account.details_submitted),
    },
  })

  if (action === 'dashboard') {
    const loginLink = await stripe.accounts.createLoginLink(accountId)
    return NextResponse.redirect(loginLink.url, { status: 303 })
  }

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${baseUrl}/dashboard/store?connect=refresh`,
    return_url: `${baseUrl}/dashboard/store?connect=success`,
    type: 'account_onboarding',
  })
  return NextResponse.redirect(accountLink.url, { status: 303 })
})
