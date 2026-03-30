import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe'
import { createAuditLog } from '@/lib/audit'
import { recordLedgerEntry } from '@/lib/ledger'
import { allocateAmountAcrossLineItems } from '@/lib/orders'
import { createSellerTransfersForOrder, reverseTransfersForOrder, syncOrderDispute } from '@/lib/payments'
import { applyRefundDeltaLedgerAdjustments } from '@/lib/finance'

function lineTotal(item: any) {
  return Number(item.priceCents || 0) * Number(item.quantity || 0)
}

function orderGross(order: any) {
  return Number(order.totalCents || 0) + Number(order.taxCents || 0)
}

function metadataObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function payoutCurrency(value: unknown) {
  const currency = String(value || 'USD').trim().toUpperCase()
  return currency || 'USD'
}

function payoutArrivalDateIso(value: unknown) {
  const ts = Number(value || 0)
  if (!Number.isFinite(ts) || ts <= 0) return null
  return new Date(ts * 1000).toISOString()
}

async function ensureChargeId(stripe: any, paymentIntentId: string | null | undefined) {
  if (!paymentIntentId) return null
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
    return paymentIntent?.latest_charge ? String(paymentIntent.latest_charge) : null
  } catch {
    return null
  }
}

async function createTransfersForOrder(stripe: any, order: any, payoutShares: number[]) {
  await createSellerTransfersForOrder({
    stripe,
    order,
    payoutShares,
    action: 'stripe.transfer.created',
    failureAction: 'stripe.transfer.failed',
    reason: 'checkout',
  })
}

async function markOrderPaid(orderId: string, session: any, stripe: any) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          asset: { include: { vendorSiteMembership: true } },
          licenseOption: true,
        },
      },
    },
  })
  if (!order || order.status === 'paid') return

  const taxCents = Number(session.total_details?.amount_tax || 0)
  const paymentIntentId = String(session.payment_intent || '') || null
  const chargeId = String((session.payment_intent && (await ensureChargeId(stripe, paymentIntentId))) || '') || null

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: 'paid',
      stripePaymentIntentId: paymentIntentId || undefined,
      stripeChargeId: chargeId || undefined,
      stripeCheckoutStatus: String(session.status || 'complete'),
      taxCents,
    },
  })

  const lineTotals = order.items.map((item: any) => lineTotal(item))
  const feeShares = allocateAmountAcrossLineItems(Number(order.platformFeeCents || 0), lineTotals)
  const taxShares = allocateAmountAcrossLineItems(taxCents, lineTotals)
  const payoutShares = allocateAmountAcrossLineItems(Number(order.vendorPayoutCents || 0), lineTotals)

  for (let index = 0; index < order.items.length; index += 1) {
    const item = order.items[index]
    const exists = await prisma.purchase.findFirst({
      where: {
        userId: order.userId,
        assetId: item.assetId,
        siteId: order.siteId,
        licenseOptionId: item.licenseOptionId || null,
      },
    })
    if (!exists) {
      await prisma.purchase.create({
        data: {
          userId: order.userId,
          assetId: item.assetId,
          orderId: order.id,
          siteId: order.siteId,
          licenseOptionId: item.licenseOptionId || undefined,
          licenseKey: randomUUID(),
        },
      })
    }

    await recordLedgerEntry({
      vendorId: item.asset.vendorId,
      siteId: order.siteId,
      vendorSiteMembershipId: item.asset.vendorSiteMembershipId || null,
      orderId: order.id,
      assetId: item.assetId,
      type: 'SALE',
      amountCents: lineTotals[index],
      currency: item.asset.currency || order.currency,
      notes: 'Checkout completed',
    })

    if (feeShares[index]) {
      await recordLedgerEntry({
        vendorId: item.asset.vendorId,
        siteId: order.siteId,
        vendorSiteMembershipId: item.asset.vendorSiteMembershipId || null,
        orderId: order.id,
        assetId: item.assetId,
        type: 'PLATFORM_FEE',
        amountCents: -Math.abs(feeShares[index]),
        currency: item.asset.currency || order.currency,
        notes: 'Marketplace fee allocation',
      })
    }

    if (taxShares[index]) {
      await recordLedgerEntry({
        vendorId: item.asset.vendorId,
        siteId: order.siteId,
        vendorSiteMembershipId: item.asset.vendorSiteMembershipId || null,
        orderId: order.id,
        assetId: item.assetId,
        type: 'TAX',
        amountCents: -Math.abs(taxShares[index]),
        currency: item.asset.currency || order.currency,
        notes: 'Tax collected allocation',
      })
    }

    if (payoutShares[index]) {
      await recordLedgerEntry({
        vendorId: item.asset.vendorId,
        siteId: order.siteId,
        vendorSiteMembershipId: item.asset.vendorSiteMembershipId || null,
        orderId: order.id,
        assetId: item.assetId,
        type: 'VENDOR_PAYOUT',
        amountCents: payoutShares[index],
        currency: item.asset.currency || order.currency,
        notes: 'Net seller amount accrued',
      })
    }
  }

  await createTransfersForOrder(stripe, { ...order, taxCents }, payoutShares)
  await createAuditLog({
    siteId: order.siteId,
    entityType: 'order',
    entityId: order.id,
    action: 'checkout.completed',
    details: {
      stripeSessionId: session.id,
      paymentIntentId: paymentIntentId || null,
      chargeId: chargeId || null,
      taxCents,
    },
  })
}

async function applyRefund(order: any, amountRefunded: number, chargeId: string | null) {
  const gross = Math.max(orderGross(order), 1)
  const cumulativeRefundedPayout = Math.round((Number(order.vendorPayoutCents || 0) * amountRefunded) / gross)
  const recordedRefunds = await prisma.vendorLedgerEntry.aggregate({
    where: { orderId: order.id, type: 'REFUND' },
    _sum: { amountCents: true },
  }).catch(() => null)
  const recordedRefundedPayout = Math.abs(Number(recordedRefunds?._sum.amountCents || 0))
  const refundDeltaPayout = Math.max(cumulativeRefundedPayout - recordedRefundedPayout, 0)
  const lineTotals = order.items.map((item: any) => lineTotal(item))
  const refundShares = allocateAmountAcrossLineItems(refundDeltaPayout, lineTotals)
  const nextStatus = amountRefunded >= gross ? 'refunded' : 'partially_refunded'

  await prisma.order.update({ where: { id: order.id }, data: { status: nextStatus, stripeChargeId: chargeId || order.stripeChargeId || undefined } })
  for (let index = 0; index < order.items.length; index += 1) {
    const item = order.items[index]
    if (!refundShares[index]) continue
    await recordLedgerEntry({
      vendorId: item.asset.vendorId,
      siteId: order.siteId,
      vendorSiteMembershipId: item.asset.vendorSiteMembershipId || null,
      orderId: order.id,
      assetId: item.assetId,
      type: 'REFUND',
      amountCents: -Math.abs(refundShares[index]),
      currency: item.asset.currency || order.currency,
      notes: 'Refund adjustment',
      metadata: {
        refundedAmountGrossCents: amountRefunded,
        cumulativeVendorRefundCents: cumulativeRefundedPayout,
        refundDeltaVendorPayoutCents: refundShares[index],
      },
    })
  }

  const transferReversal = refundDeltaPayout > 0
    ? await reverseTransfersForOrder({
        order: {
          id: order.id,
          siteId: order.siteId,
          currency: order.currency,
          stripeChargeId: chargeId || order.stripeChargeId || null,
          stripePaymentIntentId: order.stripePaymentIntentId || null,
        },
        reversalAmountCents: refundDeltaPayout,
        reason: 'refund',
      })
    : { performed: [], errors: [] as string[] }

  await createAuditLog({
    siteId: order.siteId,
    entityType: 'order',
    entityId: order.id,
    action: 'charge.refunded',
    details: {
      chargeId,
      amountRefunded,
      status: nextStatus,
      cumulativeVendorRefundCents: cumulativeRefundedPayout,
      alreadyRecordedVendorRefundCents: recordedRefundedPayout,
      refundDeltaVendorPayoutCents: refundDeltaPayout,
      transferReversalCount: transferReversal.performed.length,
      transferReversalErrors: transferReversal.errors,
    },
  })
}

async function listChargeRefunds(stripe: any, charge: any) {
  const chargeId = String(charge?.id || '').trim()
  if (!chargeId) return Array.isArray(charge?.refunds?.data) ? charge.refunds.data : []

  const refunds: any[] = []
  let startingAfter: string | null = null

  try {
    while (true) {
      const page: { data: any[]; has_more: boolean } = await stripe.refunds.list({
        charge: chargeId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      refunds.push(...(Array.isArray(page.data) ? page.data : []))
      if (!page.has_more || !page.data.length) break
      startingAfter = String(page.data[page.data.length - 1]?.id || '') || null
      if (!startingAfter) break
    }
    return refunds
  } catch {
    return Array.isArray(charge?.refunds?.data) ? charge.refunds.data : []
  }
}

async function applyRefundsForCharge(stripe: any, order: any, charge: any) {
  const refunds = (await listChargeRefunds(stripe, charge)).filter((refund: any) => {
    const status = String(refund?.status || '').toLowerCase()
    return status !== 'failed' && status !== 'canceled' && status !== 'cancelled'
  })

  if (!refunds.length) {
    await applyRefund(order, Number(charge.amount_refunded || 0), String(charge.id || ''))
    return
  }

  const refundIds = refunds.map((refund: any) => String(refund?.id || '')).filter(Boolean)
  const processed = refundIds.length
    ? await prisma.auditLog.findMany({
        where: {
          siteId: order.siteId,
          entityType: 'stripe_refund',
          entityId: { in: refundIds },
          action: 'stripe.refund.applied',
        },
        select: { entityId: true },
      }).catch(() => [])
    : []
  const processedIds = new Set(processed.map((entry: any) => String(entry.entityId || '')))
  const pendingRefunds = refunds
    .filter((refund: any) => !processedIds.has(String(refund?.id || '')))
    .sort((a: any, b: any) => Number(a?.created || 0) - Number(b?.created || 0))

  if (!pendingRefunds.length) return

  for (const refund of pendingRefunds) {
    const metadata = metadataObject(refund?.metadata)
    const assetId = String(metadata.assetId || '').trim() || null
    const supportCaseId = String(metadata.supportCaseId || '').trim() || null
    const actionMode = String(metadata.actionMode || metadata.mode || '').trim() || null
    const notes = String(metadata.notes || '').trim() || null

    try {
      await applyRefundDeltaLedgerAdjustments({
        order,
        refundId: String(refund.id || ''),
        grossRefundAmountCents: Number(refund.amount || 0),
        totalAmountRefundedGrossCents: Number(charge.amount_refunded || 0),
        chargeId: String(charge.id || '') || null,
        assetId,
        supportCaseId,
        actionMode,
        notes,
      })
    } catch (error: any) {
      await createAuditLog({
        siteId: order.siteId,
        entityType: 'stripe_refund',
        entityId: String(refund.id || `charge:${String(charge.id || 'unknown')}`),
        action: 'stripe.refund.apply_failed',
        details: {
          orderId: order.id,
          chargeId: String(charge.id || '') || null,
          assetId,
          supportCaseId,
          actionMode,
          amountCents: Number(refund.amount || 0),
          message: error?.message || 'Refund reconciliation failed',
        },
      })
    }
  }
}

async function applyDisputeReserve(order: any, amount: number, status: 'created' | 'closed', disputeId: string, won = false) {
  await syncOrderDispute({
    order,
    disputeId,
    grossAmountCents: amount,
    stage: status === 'created' ? 'created' : won ? 'won' : 'lost',
  })
}

async function findMembershipByConnectedAccount(accountId: string | null | undefined) {
  const normalized = String(accountId || '').trim()
  if (!normalized) return null
  return prisma.vendorSiteMembership.findFirst({
    where: { stripeAccountId: normalized },
    select: { id: true, siteId: true, vendorId: true, stripeAccountId: true },
  }).catch(() => null)
}

async function payoutLedgerEntryExists(membershipId: string, payoutId: string, kind: string) {
  const entries = await prisma.vendorLedgerEntry.findMany({
    where: { vendorSiteMembershipId: membershipId, type: 'ADJUSTMENT' },
    orderBy: { createdAt: 'desc' },
    take: 200,
  }).catch(() => [])

  return entries.some((entry: any) => {
    const metadata = metadataObject(entry.metadata)
    return String(metadata.payoutId || '') === payoutId && String(metadata.kind || '') === kind
  })
}

function payoutDetails(accountId: string, payout: any, overrideStatus?: string) {
  return {
    accountId,
    payoutId: String(payout.id || ''),
    amountCents: Number(payout.amount || 0),
    currency: payoutCurrency(payout.currency),
    arrivalDate: payoutArrivalDateIso(payout.arrival_date),
    status: String(overrideStatus || payout.status || ''),
    failureCode: payout.failure_code || null,
    failureMessage: payout.failure_message || null,
    destination: payout.destination || null,
    method: payout.method || null,
    payoutType: payout.type || null,
    statementDescriptor: payout.statement_descriptor || null,
  }
}

async function applyPayoutLedgerEffect(membership: { id: string; siteId: string; vendorId: string }, details: ReturnType<typeof payoutDetails>) {
  if (!details.payoutId || details.amountCents <= 0) return

  const settledAlready = await payoutLedgerEntryExists(membership.id, details.payoutId, 'stripe_payout_paid')
  const restoredAlready = await payoutLedgerEntryExists(membership.id, details.payoutId, 'stripe_payout_restored')

  if (details.status === 'paid' && !settledAlready) {
    await recordLedgerEntry({
      vendorId: membership.vendorId,
      siteId: membership.siteId,
      vendorSiteMembershipId: membership.id,
      type: 'ADJUSTMENT',
      amountCents: -Math.abs(details.amountCents),
      currency: details.currency,
      notes: 'Stripe payout settled to connected bank account',
      metadata: {
        kind: 'stripe_payout_paid',
        payoutId: details.payoutId,
        accountId: details.accountId,
        arrivalDate: details.arrivalDate,
        destination: details.destination,
        status: details.status,
      },
    })
    await createAuditLog({
      siteId: membership.siteId,
      entityType: 'vendor_membership',
      entityId: membership.id,
      action: 'stripe.payout.balance_deducted',
      details,
    })
    return
  }

  if ((details.status === 'failed' || details.status === 'canceled') && settledAlready && !restoredAlready) {
    await recordLedgerEntry({
      vendorId: membership.vendorId,
      siteId: membership.siteId,
      vendorSiteMembershipId: membership.id,
      type: 'ADJUSTMENT',
      amountCents: Math.abs(details.amountCents),
      currency: details.currency,
      notes: 'Stripe payout returned to available balance',
      metadata: {
        kind: 'stripe_payout_restored',
        payoutId: details.payoutId,
        accountId: details.accountId,
        arrivalDate: details.arrivalDate,
        destination: details.destination,
        status: details.status,
        failureCode: details.failureCode,
        failureMessage: details.failureMessage,
      },
    })
    await createAuditLog({
      siteId: membership.siteId,
      entityType: 'vendor_membership',
      entityId: membership.id,
      action: 'stripe.payout.balance_restored',
      details,
    })
  }
}

async function handlePayoutEvent(eventType: 'created' | 'updated' | 'paid' | 'failed' | 'canceled', event: any) {
  const payout = event.data.object as any
  const accountId = String(event.account || '').trim()
  const details = payoutDetails(accountId, payout, eventType === 'updated' ? String(payout.status || 'updated') : eventType)
  const membership = await findMembershipByConnectedAccount(accountId)

  if (!membership) {
    await createAuditLog({
      entityType: 'stripe_payout',
      entityId: details.payoutId || `unknown:${eventType}`,
      action: `stripe.payout.${eventType}.unmatched`,
      details,
    })
    return null
  }

  await createAuditLog({
    siteId: membership.siteId,
    entityType: 'vendor_membership',
    entityId: membership.id,
    action: `stripe.payout.${eventType}`,
    details: { ...details, vendorId: membership.vendorId },
  })

  const normalizedStatus = (() => {
    const status = String(payout.status || '').toLowerCase()
    if (eventType === 'paid' || status === 'paid') return 'paid'
    if (eventType === 'failed' || status === 'failed') return 'failed'
    if (eventType === 'canceled' || status === 'canceled' || status === 'cancelled') return 'canceled'
    return details.status
  })()

  await applyPayoutLedgerEffect(membership, { ...details, status: normalizedStatus })
  return membership.siteId
}

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  const sig = req.headers.get('stripe-signature') || ''
  const raw = await req.text()
  let event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET || '')
  } catch (err: any) {
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 })
  }

  const processed = await prisma.auditLog.findFirst({ where: { entityType: 'stripe_event', entityId: event.id } }).catch(() => null)
  if (processed) return NextResponse.json({ received: true, duplicate: true })

  let eventSiteId: string | null = null

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as any
    const orderId = session.metadata?.orderId as string | undefined
    if (orderId) {
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { siteId: true } })
      eventSiteId = order?.siteId || null
      await markOrderPaid(orderId, session, stripe)
    }
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as any
    const orderId = session.metadata?.orderId as string | undefined
    if (orderId) {
      const order = await prisma.order.findUnique({ where: { id: orderId } })
      if (order && order.status === 'created') {
        eventSiteId = order.siteId
        await prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled', stripeCheckoutStatus: 'expired' } })
        await createAuditLog({ siteId: order.siteId, entityType: 'order', entityId: order.id, action: 'checkout.expired', details: { stripeSessionId: session.id } })
      }
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object as any
    const order = await prisma.order.findFirst({ where: { stripePaymentIntentId: String(paymentIntent.id || '') } }).catch(() => null)
    if (order) {
      eventSiteId = order.siteId
      await prisma.order.update({ where: { id: order.id }, data: { status: 'payment_failed' } })
      await createAuditLog({ siteId: order.siteId, entityType: 'order', entityId: order.id, action: 'payment.failed', details: { paymentIntentId: paymentIntent.id } })
    }
  }

  if (event.type === 'account.updated') {
    const account = event.data.object as any
    const membership = await prisma.vendorSiteMembership.findFirst({ where: { stripeAccountId: account.id } }).catch(() => null)
    if (membership) {
      eventSiteId = membership.siteId
      const nextStatus = String(account.requirements?.disabled_reason ? 'restricted' : account.details_submitted ? 'active' : 'pending')
      await prisma.vendorSiteMembership.update({
        where: { id: membership.id },
        data: {
          stripeAccountStatus: nextStatus,
          stripeChargesEnabled: Boolean(account.charges_enabled),
          stripePayoutsEnabled: Boolean(account.payouts_enabled),
          stripeDetailsSubmitted: Boolean(account.details_submitted),
        },
      })
      await createAuditLog({
        siteId: membership.siteId,
        entityType: 'vendor_membership',
        entityId: membership.id,
        action: 'stripe.account.updated',
        details: {
          accountId: account.id,
          stripeAccountStatus: nextStatus,
          chargesEnabled: Boolean(account.charges_enabled),
          payoutsEnabled: Boolean(account.payouts_enabled),
          detailsSubmitted: Boolean(account.details_submitted),
          disabledReason: account.requirements?.disabled_reason || null,
        },
      })
    }
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as any
    const order = await prisma.order.findFirst({
      where: {
        OR: [
          { stripeChargeId: String(charge.id || '') },
          { stripePaymentIntentId: String(charge.payment_intent || '') },
        ],
      },
      include: { items: { include: { asset: { include: { vendorSiteMembership: true } } } } },
    }).catch(() => null)
    if (order) {
      eventSiteId = order.siteId
      await applyRefundsForCharge(stripe, order, charge)
    }
  }

  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as any
    const order = await prisma.order.findFirst({
      where: { stripeChargeId: String(dispute.charge || '') },
      include: { items: { include: { asset: { include: { vendorSiteMembership: true } } } } },
    }).catch(() => null)
    if (order) {
      eventSiteId = order.siteId
      await applyDisputeReserve(order, Number(dispute.amount || 0), 'created', String(dispute.id || ''), false)
    }
  }

  if (event.type === 'charge.dispute.closed') {
    const dispute = event.data.object as any
    const order = await prisma.order.findFirst({
      where: { stripeChargeId: String(dispute.charge || '') },
      include: { items: { include: { asset: { include: { vendorSiteMembership: true } } } } },
    }).catch(() => null)
    if (order) {
      eventSiteId = order.siteId
      const won = String(dispute.status || '').toLowerCase() === 'won'
      await applyDisputeReserve(order, Number(dispute.amount || 0), 'closed', String(dispute.id || ''), won)
    }
  }

  if (event.type === 'payout.created') {
    eventSiteId = await handlePayoutEvent('created', event) || eventSiteId
  }

  if (event.type === 'payout.updated') {
    eventSiteId = await handlePayoutEvent('updated', event) || eventSiteId
  }

  if (event.type === 'payout.paid') {
    eventSiteId = await handlePayoutEvent('paid', event) || eventSiteId
  }

  if (event.type === 'payout.failed') {
    eventSiteId = await handlePayoutEvent('failed', event) || eventSiteId
  }

  if (event.type === 'payout.canceled') {
    eventSiteId = await handlePayoutEvent('canceled', event) || eventSiteId
  }

  await createAuditLog({
    siteId: eventSiteId,
    entityType: 'stripe_event',
    entityId: event.id,
    action: `stripe.event.${event.type}`,
    details: {
      livemode: event.livemode,
      created: event.created,
      account: event.account || null,
    },
  })
  return NextResponse.json({ received: true })
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
