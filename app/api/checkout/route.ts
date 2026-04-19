import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { getStripe } from '@/lib/stripe'
import { getActiveSiteForRequest } from '@/lib/site'
import { marketplaceFeeBreakdown } from '@/lib/utils'
import { createAuditLog } from '@/lib/audit'
import { withRedirectAuth } from '@/lib/route-auth'

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function parseAssetIds(form: FormData) {
  const direct = form.getAll('assetId').map((value) => String(value).trim())
  const grouped = String(form.get('assetIds') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return unique([...direct, ...grouped])
}

function parseLicenseSelections(form: FormData) {
  const map: Record<string, string> = {}
  const raw = form.get('licenseSelections')?.toString() || ''
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [assetId, licenseOptionId] of Object.entries(parsed)) {
        if (assetId && licenseOptionId) map[assetId] = String(licenseOptionId)
      }
    } catch {
    }
  }

  const singleAssetId = form.get('assetId')?.toString() || ''
  const singleLicenseOptionId = form.get('licenseOptionId')?.toString() || ''
  if (singleAssetId && singleLicenseOptionId) map[singleAssetId] = singleLicenseOptionId
  return map
}

export const POST = withRedirectAuth(async function POST(req: NextRequest) {
  const user = await requireUser()
  const site = await getActiveSiteForRequest(req)
  const form = await req.formData()
  const assetIds = parseAssetIds(form)
  const licenseSelections = parseLicenseSelections(form)

  if (!assetIds.length) return NextResponse.json({ error: 'Missing assetId' }, { status: 400 })

  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds }, siteId: site.id, status: 'APPROVED' },
    include: {
      licenseOptions: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      vendorSiteMembership: true,
      category: true,
    },
  })

  const assetMap = new Map(assets.map((asset: any) => [asset.id, asset]))
  const orderedAssets = assetIds.map((id) => assetMap.get(id)).filter(Boolean) as any[]
  if (!orderedAssets.length || orderedAssets.length !== assetIds.length) {
    return NextResponse.redirect(new URL('/dashboard/collections?checkout=missing-asset', req.url), { status: 303 })
  }

  for (const asset of orderedAssets) {
    if (asset.vendorSiteMembership?.status !== 'APPROVED' || asset.downloadsDisabled) {
      return NextResponse.redirect(new URL(`/assets/${asset.id}?support=download-frozen`, req.url), { status: 303 })
    }
  }

  const currencies = unique(orderedAssets.map((asset) => String(asset.currency || 'USD').toUpperCase()))
  if (currencies.length > 1) {
    return NextResponse.redirect(new URL('/dashboard/collections?checkout=currency-mismatch', req.url), { status: 303 })
  }

  const existingPurchases = await prisma.purchase.findMany({
    where: { userId: user.id, siteId: site.id, assetId: { in: assetIds } },
    select: { assetId: true, licenseOptionId: true },
  })
  const ownedKeys = new Set(existingPurchases.map((purchase: any) => `${purchase.assetId}::${purchase.licenseOptionId || '__base__'}`))

  const selections = orderedAssets
    .map((asset) => {
      const explicitLicenseId = licenseSelections[asset.id]
      const selectedLicense = asset.licenseOptions.find((option: any) => option.id === explicitLicenseId) || asset.licenseOptions[0] || null
      const unitAmount = Number(selectedLicense?.priceCents ?? asset.priceCents)
      return { asset, selectedLicense, unitAmount }
    })
    .filter((selection) => !ownedKeys.has(`${selection.asset.id}::${selection.selectedLicense?.id || '__base__'}`))

  if (!selections.length) {
    const redirectUrl = assetIds.length === 1 ? `/assets/${assetIds[0]}?checkout=owned` : '/dashboard/collections?checkout=owned'
    return NextResponse.redirect(new URL(redirectUrl, req.url), { status: 303 })
  }

  const subtotalCents = selections.reduce((sum, selection) => sum + selection.unitAmount, 0)
  const { platformFeeCents, vendorPayoutCents } = marketplaceFeeBreakdown(subtotalCents)
  const currency = currencies[0] || 'USD'
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin
  const transferGroup = `order_${Date.now()}_${user.id.slice(-6)}`

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      siteId: site.id,
      totalCents: subtotalCents,
      currency,
      status: 'created',
      platformFeeCents,
      vendorPayoutCents,
      taxCents: 0,
      items: {
        create: selections.map((selection) => ({
          assetId: selection.asset.id,
          licenseOptionId: selection.selectedLicense?.id,
          priceCents: selection.unitAmount,
          quantity: 1,
        })),
      },
    },
  })

  const stripe = getStripe()
  const sessionPayload: any = {
    mode: 'payment',
    customer_email: user.email,
    customer_creation: 'always',
    billing_address_collection: process.env.STRIPE_AUTOMATIC_TAX === 'true' ? 'required' : 'auto',
    line_items: selections.map((selection) => ({
      price_data: {
        currency: currency.toLowerCase(),
        product_data: {
          name: selection.asset.title,
          description: selection.selectedLicense ? `${selection.selectedLicense.name} license` : 'Digital asset',
          ...(selection.asset.taxCode ? { tax_code: selection.asset.taxCode } : {}),
          metadata: {
            assetId: selection.asset.id,
            categoryId: selection.asset.categoryId,
            licenseOptionId: selection.selectedLicense?.id || '',
            vendorMembershipId: selection.asset.vendorSiteMembershipId || '',
          },
        },
        unit_amount: selection.unitAmount,
        ...(selection.asset.taxBehavior ? { tax_behavior: selection.asset.taxBehavior } : {}),
      },
      quantity: 1,
    })),
    success_url: process.env.STRIPE_SUCCESS_URL || `${baseUrl}/dashboard/receipts?checkout=success`,
    cancel_url: selections.length === 1 ? `${baseUrl}/assets/${selections[0].asset.id}` : `${baseUrl}/dashboard/collections?checkout=cancelled`,
    metadata: {
      orderId: order.id,
      siteId: site.id,
      assetIds: selections.map((selection) => selection.asset.id).join(','),
      lineItemCount: String(selections.length),
      transferGroup,
    },
    payment_intent_data: {
      metadata: { orderId: order.id, siteId: site.id, transferGroup },
      transfer_group: transferGroup,
    },
  }

  if (process.env.STRIPE_AUTOMATIC_TAX === 'true') sessionPayload.automatic_tax = { enabled: true }
  if (process.env.STRIPE_TAX_ID_COLLECTION === 'true') sessionPayload.tax_id_collection = { enabled: true }

  const session = await stripe.checkout.sessions.create(sessionPayload)
  await prisma.order.update({
    where: { id: order.id },
    data: {
      stripeSessionId: session.id,
      stripeTransferGroup: transferGroup,
      stripeCheckoutStatus: String(session.status || 'open'),
    },
  })

  await createAuditLog({
    actorUserId: user.id,
    siteId: site.id,
    entityType: 'order',
    entityId: order.id,
    action: 'checkout.created',
    details: {
      assetIds: selections.map((selection) => selection.asset.id),
      licenseOptionIds: selections.map((selection) => selection.selectedLicense?.id || null),
      transferGroup,
      subtotalCents,
      skippedOwnedAssets: assetIds.length - selections.length,
    },
  })

  return NextResponse.redirect(session.url!, { status: 303 })
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
