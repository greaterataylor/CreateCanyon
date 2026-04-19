import { prisma } from './prisma'
import { createAuditLog } from './audit'
import { recordLedgerEntry } from './ledger'
import { allocateAmountAcrossLineItems } from './orders'
import { getStripe } from './stripe'
import { ApiError } from './api'
import { reverseTransfersForOrder } from './payments'

function asRecord(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function numericValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizedAssetId(value: string | null | undefined) {
  const assetId = String(value || '').trim()
  return assetId || null
}

function itemMatchesAsset(item: any, assetId?: string | null) {
  const normalized = normalizedAssetId(assetId)
  if (!normalized) return true
  return String(item?.assetId || '') === normalized
}

export function lineTotal(item: any) {
  return Number(item?.priceCents || 0) * Number(item?.quantity || 0)
}

export function orderGross(order: any) {
  return Number(order?.totalCents || 0) + Number(order?.taxCents || 0)
}

export function getLineTotals(order: any) {
  return Array.isArray(order?.items) ? order.items.map((item: any) => lineTotal(item)) : []
}

export function getTaxShares(order: any) {
  return allocateAmountAcrossLineItems(Number(order?.taxCents || 0), getLineTotals(order))
}

export function getGrossLineTotals(order: any) {
  const lineTotals = getLineTotals(order)
  const taxShares = getTaxShares(order)
  return lineTotals.map((amount: number, index: number) => amount + Number(taxShares[index] || 0))
}

export function getGrossAmountForAsset(order: any, assetId: string) {
  if (!assetId) return orderGross(order)
  const taxShares = getTaxShares(order)
  return (Array.isArray(order?.items) ? order.items : []).reduce((sum: number, item: any, index: number) => {
    if (String(item?.assetId || '') !== assetId) return sum
    return sum + lineTotal(item) + Number(taxShares[index] || 0)
  }, 0)
}

function getEligibleLineTotals(order: any, assetId?: string | null) {
  const items = Array.isArray(order?.items) ? order.items : []
  const totals = getLineTotals(order)
  return totals.map((amount: number, index: number) => itemMatchesAsset(items[index], assetId) ? amount : 0)
}

function getEligibleGrossLineTotals(order: any, assetId?: string | null) {
  const items = Array.isArray(order?.items) ? order.items : []
  const grossTotals = getGrossLineTotals(order)
  return grossTotals.map((amount: number, index: number) => itemMatchesAsset(items[index], assetId) ? amount : 0)
}

export async function ensureChargeId(stripe: any, paymentIntentId: string | null | undefined) {
  if (!paymentIntentId) return null
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
    return paymentIntent?.latest_charge ? String(paymentIntent.latest_charge) : null
  } catch {
    return null
  }
}

export async function getAppliedRefundGrossCents(orderId: string) {
  const entries = await prisma.vendorLedgerEntry.findMany({
    where: { orderId, type: 'REFUND' as any },
    select: { metadata: true },
  }).catch(() => [])

  return entries.reduce((maxTotal: number, entry: any) => {
    const metadata = asRecord(entry?.metadata)
    const total = numericValue(metadata.refundedGrossTotalCents ?? metadata.refundedAmountGrossCents)
    return total > maxTotal ? total : maxTotal
  }, 0)
}

export async function applyRefundLedgerAdjustments(order: any, totalAmountRefundedGrossCents: number, chargeId: string | null, metadataExtras: Record<string, unknown> = {}) {
  const gross = Math.max(orderGross(order), 1)
  const nextStatus = Number(totalAmountRefundedGrossCents || 0) >= gross ? 'refunded' : 'partially_refunded'
  const previousRefundedGrossCents = await getAppliedRefundGrossCents(order.id)
  const refundDeltaGrossCents = Math.max(Number(totalAmountRefundedGrossCents || 0) - previousRefundedGrossCents, 0)

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: nextStatus,
      stripeChargeId: chargeId || order.stripeChargeId || undefined,
    },
  })

  if (refundDeltaGrossCents > 0) {
    const lineTotals = getLineTotals(order)
    const grossLineTotals = getGrossLineTotals(order)
    const refundedPayoutDeltaCents = Math.round((Number(order.vendorPayoutCents || 0) * refundDeltaGrossCents) / gross)
    const refundPayoutShares = allocateAmountAcrossLineItems(refundedPayoutDeltaCents, lineTotals)
    const refundGrossShares = allocateAmountAcrossLineItems(refundDeltaGrossCents, grossLineTotals)

    for (let index = 0; index < order.items.length; index += 1) {
      const item = order.items[index]
      if (!refundPayoutShares[index]) continue
      await recordLedgerEntry({
        vendorId: item.asset.vendorId,
        siteId: order.siteId,
        vendorSiteMembershipId: item.asset.vendorSiteMembershipId || null,
        orderId: order.id,
        assetId: item.assetId,
        type: 'REFUND',
        amountCents: -Math.abs(refundPayoutShares[index]),
        currency: item.asset.currency || order.currency,
        notes: 'Refund adjustment',
        metadata: {
          chargeId,
          refundDeltaGrossCents,
          refundedGrossTotalCents: totalAmountRefundedGrossCents,
          assetRefundGrossDeltaCents: Number(refundGrossShares[index] || 0),
          ...metadataExtras,
        },
      })
    }
  }

  await createAuditLog({
    siteId: order.siteId,
    entityType: 'order',
    entityId: order.id,
    action: 'charge.refunded',
    details: {
      chargeId,
      amountRefunded: totalAmountRefundedGrossCents,
      refundDeltaGrossCents,
      status: nextStatus,
      ...metadataExtras,
    },
  })

  return {
    nextStatus,
    previousRefundedGrossCents,
    refundDeltaGrossCents,
    totalAmountRefundedGrossCents,
  }
}

export async function applyRefundDeltaLedgerAdjustments(input: {
  order: any
  refundId: string
  grossRefundAmountCents: number
  totalAmountRefundedGrossCents: number
  chargeId: string | null
  assetId?: string | null
  supportCaseId?: string | null
  actionMode?: string | null
  notes?: string | null
  actorUserId?: string | null
}) {
  const assetId = normalizedAssetId(input.assetId)
  const gross = Math.max(orderGross(input.order), 1)
  const eligibleGrossCents = assetId ? getGrossAmountForAsset(input.order, assetId) : orderGross(input.order)

  if (assetId && eligibleGrossCents <= 0) {
    throw new ApiError(400, 'Refund asset does not belong to this order.')
  }

  const grossRefundAmountCents = Math.min(Math.max(Math.round(Number(input.grossRefundAmountCents || 0)), 0), Math.max(eligibleGrossCents, 0))
  if (grossRefundAmountCents <= 0) {
    throw new ApiError(400, 'Refund amount must be greater than zero.')
  }

  const targetLineTotals = getEligibleLineTotals(input.order, assetId)
  const targetGrossLineTotals = getEligibleGrossLineTotals(input.order, assetId)
  const refundedPayoutDeltaCents = Math.round((Number(input.order.vendorPayoutCents || 0) * grossRefundAmountCents) / gross)
  const refundPayoutShares = allocateAmountAcrossLineItems(refundedPayoutDeltaCents, targetLineTotals)
  const refundGrossShares = allocateAmountAcrossLineItems(grossRefundAmountCents, targetGrossLineTotals)
  const nextStatus = Number(input.totalAmountRefundedGrossCents || 0) >= gross ? 'refunded' : 'partially_refunded'

  await prisma.order.update({
    where: { id: input.order.id },
    data: {
      status: nextStatus,
      stripeChargeId: input.chargeId || input.order.stripeChargeId || undefined,
    },
  })

  for (let index = 0; index < input.order.items.length; index += 1) {
    const item = input.order.items[index]
    if (!refundPayoutShares[index]) continue
    await recordLedgerEntry({
      vendorId: item.asset.vendorId,
      siteId: input.order.siteId,
      vendorSiteMembershipId: item.asset.vendorSiteMembershipId || null,
      orderId: input.order.id,
      assetId: item.assetId,
      type: 'REFUND',
      amountCents: -Math.abs(refundPayoutShares[index]),
      currency: item.asset.currency || input.order.currency,
      notes: input.notes || 'Refund adjustment',
      metadata: {
        refundId: input.refundId,
        chargeId: input.chargeId,
        supportCaseId: input.supportCaseId || null,
        actionMode: input.actionMode || null,
        assetId,
        refundDeltaGrossCents: grossRefundAmountCents,
        refundedGrossTotalCents: input.totalAmountRefundedGrossCents,
        assetRefundGrossDeltaCents: Number(refundGrossShares[index] || 0),
      },
    })
  }

  const transferReversal = refundedPayoutDeltaCents > 0
    ? await reverseTransfersForOrder({
        order: input.order,
        reversalAmountCents: refundedPayoutDeltaCents,
        reason: 'refund',
        actorUserId: input.actorUserId || null,
        supportCaseId: input.supportCaseId || null,
        assetId,
      })
    : { performed: [] as any[], errors: [] as string[] }

  await createAuditLog({
    actorUserId: input.actorUserId || undefined,
    siteId: input.order.siteId,
    entityType: 'order',
    entityId: input.order.id,
    action: 'charge.refunded',
    details: {
      refundId: input.refundId,
      chargeId: input.chargeId,
      amountRefunded: input.totalAmountRefundedGrossCents,
      refundDeltaGrossCents: grossRefundAmountCents,
      refundDeltaVendorPayoutCents: refundedPayoutDeltaCents,
      transferReversalCount: transferReversal.performed.length,
      transferReversalErrors: transferReversal.errors,
      assetId,
      supportCaseId: input.supportCaseId || null,
      actionMode: input.actionMode || null,
      notes: input.notes || null,
      status: nextStatus,
    },
  })

  await createAuditLog({
    actorUserId: input.actorUserId || undefined,
    siteId: input.order.siteId,
    entityType: 'stripe_refund',
    entityId: input.refundId,
    action: 'stripe.refund.applied',
    details: {
      orderId: input.order.id,
      chargeId: input.chargeId,
      grossRefundAmountCents,
      totalAmountRefundedGrossCents: input.totalAmountRefundedGrossCents,
      refundDeltaVendorPayoutCents: refundedPayoutDeltaCents,
      transferReversalCount: transferReversal.performed.length,
      transferReversalErrors: transferReversal.errors,
      assetId,
      supportCaseId: input.supportCaseId || null,
      actionMode: input.actionMode || null,
      notes: input.notes || null,
      status: nextStatus,
    },
  })

  return {
    nextStatus,
    refundedPayoutDeltaCents,
    transferReversalCount: transferReversal.performed.length,
    transferReversalErrors: transferReversal.errors,
    grossRefundAmountCents,
  }
}

export async function createSupportRefund(input: {
  siteId: string
  caseId: string
  orderId: string
  assetId?: string | null
  requestedByUserId: string
  refundMode: 'refund' | 'partial_refund'
  refundAmountCents?: number | null
  resolutionNotes?: string | null
}) {
  const existingRefund = await prisma.auditLog.findFirst({
    where: {
      siteId: input.siteId,
      entityType: 'support_case',
      entityId: input.caseId,
      action: { in: ['support-case.action.refund.completed', 'support-case.action.partial_refund.completed'] },
    },
  }).catch(() => null)
  if (existingRefund) throw new ApiError(409, 'A refund has already been executed for this support case.')

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: {
      items: {
        include: {
          asset: { include: { vendorSiteMembership: true } },
        },
      },
    },
  })

  if (!order || order.siteId !== input.siteId) throw new ApiError(404, 'Order not found for this support case.')
  if (!order.items.length) throw new ApiError(400, 'Order does not contain any refundable items.')
  if (input.assetId && !order.items.some((item: any) => String(item.assetId || '') === input.assetId)) {
    throw new ApiError(400, 'The selected asset does not belong to this order.')
  }

  const stripe = getStripe()
  const chargeId = order.stripeChargeId || await ensureChargeId(stripe, order.stripePaymentIntentId)
  let charge: any = null
  if (chargeId) {
    charge = await stripe.charges.retrieve(chargeId).catch(() => null)
  }
  if (!chargeId && !order.stripePaymentIntentId) {
    throw new ApiError(400, 'Order has no Stripe payment reference available for refunds.')
  }

  const eligibleGrossCents = input.assetId ? getGrossAmountForAsset(order, input.assetId) : orderGross(order)
  if (eligibleGrossCents <= 0) throw new ApiError(400, 'No refundable amount was found for this support case.')

  const supportRefundLogs = await prisma.auditLog.findMany({
    where: {
      siteId: input.siteId,
      entityType: 'support_case',
      action: { in: ['support-case.action.refund.completed', 'support-case.action.partial_refund.completed'] },
    },
    select: { details: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  }).catch(() => [])

  const alreadyRefundedForAssetGrossCents = supportRefundLogs.reduce((sum: number, entry: any) => {
    const details = asRecord(entry?.details)
    if (String(details.orderId || '') !== order.id) return sum
    if (String(details.assetId || '') !== String(input.assetId || '')) return sum
    return sum + numericValue(details.grossRefundAmountCents)
  }, 0)

  const remainingEligibleGrossCents = Math.max(eligibleGrossCents - alreadyRefundedForAssetGrossCents, 0)
  if (remainingEligibleGrossCents <= 0) throw new ApiError(409, 'This support case has no refundable balance remaining.')

  let requestedGrossCents = input.refundMode === 'partial_refund'
    ? Math.round(Number(input.refundAmountCents || 0))
    : remainingEligibleGrossCents

  if (input.refundMode === 'partial_refund' && requestedGrossCents <= 0) {
    throw new ApiError(400, 'Enter a partial refund amount in cents.')
  }

  const remainingChargeGrossCents = charge
    ? Math.max(Number(charge.amount || 0) - Number(charge.amount_refunded || 0), 0)
    : remainingEligibleGrossCents

  requestedGrossCents = Math.min(requestedGrossCents, remainingEligibleGrossCents, remainingChargeGrossCents)
  if (requestedGrossCents <= 0) throw new ApiError(409, 'There is no remaining Stripe balance available to refund for this order.')

  const refundMetadata = {
    supportCaseId: input.caseId,
    orderId: order.id,
    assetId: input.assetId || '',
    siteId: input.siteId,
    mode: input.refundMode,
    actionMode: input.refundMode,
    notes: input.resolutionNotes || '',
  }

  const refundPayload = chargeId
    ? {
        charge: chargeId,
        amount: requestedGrossCents,
        reason: 'requested_by_customer' as const,
        metadata: refundMetadata,
      }
    : {
        payment_intent: order.stripePaymentIntentId!,
        amount: requestedGrossCents,
        reason: 'requested_by_customer' as const,
        metadata: refundMetadata,
      }

  const refund = await stripe.refunds.create(refundPayload as any, {
    idempotencyKey: `support-case:${input.caseId}:${input.refundMode}:${requestedGrossCents}`,
  })

  await createAuditLog({
    actorUserId: input.requestedByUserId,
    siteId: input.siteId,
    entityType: 'support_case',
    entityId: input.caseId,
    action: `support-case.action.${input.refundMode}.completed`,
    details: {
      orderId: order.id,
      assetId: input.assetId || null,
      refundId: refund.id,
      grossRefundAmountCents: requestedGrossCents,
      remainingEligibleGrossCents: Math.max(remainingEligibleGrossCents - requestedGrossCents, 0),
      chargeId: chargeId || null,
      paymentIntentId: order.stripePaymentIntentId || null,
      resolutionNotes: input.resolutionNotes || null,
    },
  })

  return {
    order,
    refundId: refund.id,
    chargeId: chargeId || null,
    grossRefundAmountCents: requestedGrossCents,
    remainingEligibleGrossCents: Math.max(remainingEligibleGrossCents - requestedGrossCents, 0),
  }
}
