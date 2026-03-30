import { prisma } from './prisma'
import { createAuditLog } from './audit'
import { allocateAmountAcrossLineItems } from './orders'
import { getStripe } from './stripe'

type OrderLike = {
  id: string
  siteId: string
  currency?: string | null
  stripeChargeId?: string | null
  stripePaymentIntentId?: string | null
  stripeTransferGroup?: string | null
  vendorPayoutCents?: number | null
  taxCents?: number | null
  items?: any[]
}

type TransferAuditRecord = {
  transferId: string
  amountCents: number
  destination: string | null
  membershipId: string | null
  vendorId: string | null
  action: string
}

function detailsRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numericValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function lineTotal(item: any) {
  return Number(item?.priceCents || 0) * Number(item?.quantity || 0)
}

function orderGross(order: any) {
  return Number(order?.totalCents || 0) + Number(order?.taxCents || 0)
}

function lineTotals(order: any) {
  return Array.isArray(order?.items) ? order.items.map((item: any) => lineTotal(item)) : []
}

function taxShares(order: any) {
  return allocateAmountAcrossLineItems(Number(order?.taxCents || 0), lineTotals(order))
}

function grossLineTotals(order: any) {
  const grossShares = taxShares(order)
  return lineTotals(order).map((amount, index) => amount + Number(grossShares[index] || 0))
}

function grossAmountForAsset(order: any, assetId?: string | null) {
  if (!assetId) return orderGross(order)
  const grossShares = taxShares(order)
  return (Array.isArray(order?.items) ? order.items : []).reduce((sum: number, item: any, index: number) => {
    if (String(item?.assetId || '') !== String(assetId || '')) return sum
    return sum + lineTotal(item) + Number(grossShares[index] || 0)
  }, 0)
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

function scopedLineTotals(order: any, assetId?: string | null) {
  const items = Array.isArray(order?.items) ? order.items : []
  return lineTotals(order).map((amount: number, index: number) => itemMatchesAsset(items[index], assetId) ? amount : 0)
}

async function loadOrderWithItems(order: OrderLike | any) {
  if (Array.isArray(order?.items) && order.items.length) return order as any
  return prisma.order.findUnique({
    where: { id: order.id },
    include: {
      items: {
        include: {
          asset: { include: { vendorSiteMembership: true } },
        },
      },
    },
  }).catch(() => null)
}

function scopedTransferFilters(order: any, assetId?: string | null) {
  const membershipIds = new Set<string>()
  const vendorIds = new Set<string>()

  for (const item of Array.isArray(order?.items) ? order.items : []) {
    if (!itemMatchesAsset(item, assetId)) continue
    const membershipId = item?.asset?.vendorSiteMembershipId || item?.asset?.vendorSiteMembership?.id
    if (membershipId) membershipIds.add(String(membershipId))
    if (item?.asset?.vendorId) vendorIds.add(String(item.asset.vendorId))
  }

  return { membershipIds, vendorIds }
}

async function getAppliedRefundGrossCents(orderId: string) {
  const entries = await prisma.vendorLedgerEntry.findMany({
    where: { orderId, type: 'REFUND' as any },
    select: { metadata: true },
  }).catch(() => [])

  return entries.reduce((maxTotal: number, entry: any) => {
    const metadata = detailsRecord(entry?.metadata)
    const total = numericValue(metadata.refundedGrossTotalCents ?? metadata.refundedAmountGrossCents)
    return total > maxTotal ? total : maxTotal
  }, 0)
}

async function getRecordedDisputeAmountCents(orderId: string, disputeId: string, type: 'DISPUTE_RESERVE' | 'DISPUTE_RELEASE') {
  const entries = await prisma.vendorLedgerEntry.findMany({
    where: { orderId, type: type as any },
    select: { amountCents: true, metadata: true },
  }).catch(() => [])

  return entries.reduce((sum: number, entry: any) => {
    const metadata = detailsRecord(entry?.metadata)
    if (String(metadata.disputeId || '') !== disputeId) return sum
    return sum + Math.abs(Number(entry.amountCents || 0))
  }, 0)
}

async function resolveOrderStatusAfterDispute(order: OrderLike) {
  const refundedGrossCents = await getAppliedRefundGrossCents(order.id)
  const gross = Math.max(orderGross(order), 1)
  if (refundedGrossCents >= gross) return 'refunded'
  if (refundedGrossCents > 0) return 'partially_refunded'
  return 'paid'
}

export async function resolveOrderCharge(order: OrderLike, stripe = getStripe()) {
  let paymentIntentId = order.stripePaymentIntentId ? String(order.stripePaymentIntentId) : null
  let chargeId = order.stripeChargeId ? String(order.stripeChargeId) : null
  let charge: any = null

  if (!chargeId && paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
      chargeId = paymentIntent?.latest_charge ? String(paymentIntent.latest_charge) : null
    } catch {
      chargeId = null
    }
  }

  if (chargeId) {
    try {
      charge = await stripe.charges.retrieve(chargeId)
      if (!paymentIntentId && charge && typeof charge !== 'string' && charge.payment_intent) {
        paymentIntentId = String(charge.payment_intent)
      }
    } catch {
      charge = null
    }
  }

  const chargeAmount = charge && typeof charge !== 'string' ? Number(charge.amount || 0) : 0
  const refundedAmount = charge && typeof charge !== 'string' ? Number(charge.amount_refunded || 0) : 0

  return {
    paymentIntentId,
    chargeId,
    charge,
    chargeAmountCents: chargeAmount,
    refundedAmountCents: refundedAmount,
    refundableAmountCents: Math.max(chargeAmount - refundedAmount, 0),
  }
}

export async function createOrderRefund(input: {
  order: OrderLike
  amountCents?: number | null
  actorUserId?: string | null
  supportCaseId?: string | null
  actionMode?: string | null
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent'
  notes?: string | null
}) {
  const stripe = getStripe()
  const resolved = await resolveOrderCharge(input.order, stripe)
  if (!resolved.chargeId && !resolved.paymentIntentId) {
    return { error: 'This order does not have a refundable Stripe charge yet.' }
  }
  if (!resolved.refundableAmountCents) {
    return { error: 'This order has no refundable balance remaining.' }
  }

  const requestedAmount = input.amountCents == null ? resolved.refundableAmountCents : Math.round(Number(input.amountCents || 0))
  const effectiveAmount = Math.min(Math.max(requestedAmount, 0), resolved.refundableAmountCents)
  if (!effectiveAmount) return { error: 'Refund amount must be greater than zero.' }

  try {
    const refundNotes = String(input.notes || '').trim()
    const idempotencyKey = [
      input.order.siteId,
      input.order.id,
      input.supportCaseId || 'manual',
      input.actionMode || 'refund',
      String(effectiveAmount),
    ].join(':').slice(0, 255)

    const refund = await stripe.refunds.create(
      {
        ...(resolved.chargeId ? { charge: resolved.chargeId } : {}),
        ...(!resolved.chargeId && resolved.paymentIntentId ? { payment_intent: resolved.paymentIntentId } : {}),
        amount: effectiveAmount,
        ...(input.reason ? { reason: input.reason } : {}),
        metadata: {
          orderId: input.order.id,
          siteId: input.order.siteId,
          supportCaseId: input.supportCaseId || '',
          actionMode: input.actionMode || '',
          notes: refundNotes,
        },
      },
      { idempotencyKey },
    )

    await createAuditLog({
      actorUserId: input.actorUserId || undefined,
      siteId: input.order.siteId,
      entityType: 'order',
      entityId: input.order.id,
      action: 'refund.requested',
      details: {
        stripeRefundId: refund.id,
        chargeId: resolved.chargeId,
        paymentIntentId: resolved.paymentIntentId,
        requestedAmountCents: requestedAmount,
        refundAmountCents: effectiveAmount,
        remainingRefundableAmountCents: resolved.refundableAmountCents - effectiveAmount,
        supportCaseId: input.supportCaseId || null,
        actionMode: input.actionMode || null,
      },
    })

    return {
      refund,
      refundAmountCents: effectiveAmount,
      chargeId: resolved.chargeId,
      paymentIntentId: resolved.paymentIntentId,
    }
  } catch (error: any) {
    await createAuditLog({
      actorUserId: input.actorUserId || undefined,
      siteId: input.order.siteId,
      entityType: 'order',
      entityId: input.order.id,
      action: 'refund.request.failed',
      details: {
        chargeId: resolved.chargeId,
        paymentIntentId: resolved.paymentIntentId,
        requestedAmountCents: requestedAmount,
        message: error?.message || 'Refund failed',
        supportCaseId: input.supportCaseId || null,
        actionMode: input.actionMode || null,
      },
    })
    return { error: error?.message || 'Refund failed.' }
  }
}

async function listOrderTransfers(orderId: string, siteId: string): Promise<TransferAuditRecord[]> {
  const logs = await prisma.auditLog.findMany({
    where: {
      siteId,
      entityType: 'order',
      entityId: orderId,
      action: { in: ['stripe.transfer.created', 'stripe.transfer.restore.created'] },
    },
    orderBy: { createdAt: 'asc' },
  })

  const transfers = new Map<string, TransferAuditRecord>()
  for (const log of logs) {
    const details = detailsRecord(log.details)
    const transferId = String(details.transferId || '').trim()
    if (!transferId) continue
    const amountCents = Number(details.amount || 0)
    if (!Number.isFinite(amountCents) || amountCents <= 0) continue
    transfers.set(transferId, {
      transferId,
      amountCents,
      destination: details.destination ? String(details.destination) : null,
      membershipId: details.membershipId ? String(details.membershipId) : null,
      vendorId: details.vendorId ? String(details.vendorId) : null,
      action: log.action,
    })
  }

  return [...transfers.values()]
}

export async function createSellerTransfersForOrder(input: {
  order: any
  payoutShares: number[]
  stripe?: any
  actorUserId?: string | null
  supportCaseId?: string | null
  disputeId?: string | null
  action?: 'stripe.transfer.created' | 'stripe.transfer.restore.created'
  failureAction?: 'stripe.transfer.failed' | 'stripe.transfer.restore.failed'
  reason?: string | null
}) {
  const action = input.action || 'stripe.transfer.created'
  const failureAction = input.failureAction || (action === 'stripe.transfer.restore.created' ? 'stripe.transfer.restore.failed' : 'stripe.transfer.failed')
  const reason = String(input.reason || (action === 'stripe.transfer.restore.created' ? 'dispute_release' : 'checkout')).trim() || 'checkout'
  const stripe = input.stripe || getStripe()
  const transferGroups = new Map<string, { amount: number; membershipId: string; vendorId: string }>()

  for (let index = 0; index < input.order.items.length; index += 1) {
    const item = input.order.items[index]
    const destination = item.asset.vendorSiteMembership?.stripeAccountId
    if (!destination) continue
    const amount = Number(input.payoutShares[index] || 0)
    if (amount <= 0) continue
    const existing = transferGroups.get(destination) || {
      amount: 0,
      membershipId: item.asset.vendorSiteMembership?.id || '',
      vendorId: item.asset.vendorId,
    }
    existing.amount += amount
    transferGroups.set(destination, existing)
  }

  const performed: Array<{ transferId: string; amountCents: number; destination: string }> = []
  const errors: string[] = []

  for (const [destination, payload] of transferGroups.entries()) {
    try {
      const transfer = await stripe.transfers.create({
        amount: payload.amount,
        currency: String(input.order.currency || 'USD').toLowerCase(),
        destination,
        transfer_group: input.order.stripeTransferGroup || undefined,
        metadata: {
          orderId: input.order.id,
          siteId: input.order.siteId,
          membershipId: payload.membershipId,
          vendorId: payload.vendorId,
          reason,
          disputeId: input.disputeId || '',
          supportCaseId: input.supportCaseId || '',
        },
      }, {
        idempotencyKey: [
          action,
          input.order.siteId,
          input.order.id,
          destination,
          reason,
          input.disputeId || '',
          input.supportCaseId || '',
          String(payload.amount),
        ].join(':').slice(0, 255),
      })

      performed.push({ transferId: transfer.id, amountCents: payload.amount, destination })
      await createAuditLog({
        actorUserId: input.actorUserId || undefined,
        siteId: input.order.siteId,
        entityType: 'order',
        entityId: input.order.id,
        action,
        details: {
          destination,
          amount: payload.amount,
          transferId: transfer.id,
          membershipId: payload.membershipId,
          vendorId: payload.vendorId,
          reason,
          disputeId: input.disputeId || null,
          supportCaseId: input.supportCaseId || null,
        },
      })
    } catch (error: any) {
      const message = error?.message || 'Transfer failed'
      errors.push(message)
      await createAuditLog({
        actorUserId: input.actorUserId || undefined,
        siteId: input.order.siteId,
        entityType: 'order',
        entityId: input.order.id,
        action: failureAction,
        details: {
          destination,
          amount: payload.amount,
          membershipId: payload.membershipId,
          vendorId: payload.vendorId,
          reason,
          disputeId: input.disputeId || null,
          supportCaseId: input.supportCaseId || null,
          message,
        },
      })
    }
  }

  return { performed, errors }
}

export async function reverseTransfersForOrder(input: {
  order: OrderLike
  reversalAmountCents: number
  reason: 'refund' | 'dispute'
  actorUserId?: string | null
  supportCaseId?: string | null
  disputeId?: string | null
  assetId?: string | null
}) {
  const stripe = getStripe()
  const loadedOrder = input.assetId ? await loadOrderWithItems(input.order) : input.order
  let transfers = await listOrderTransfers(input.order.id, input.order.siteId)

  if (input.assetId && loadedOrder) {
    const { membershipIds, vendorIds } = scopedTransferFilters(loadedOrder, input.assetId)
    if (membershipIds.size || vendorIds.size) {
      transfers = transfers.filter((transfer) => {
        if (transfer.membershipId && membershipIds.has(String(transfer.membershipId))) return true
        if (transfer.vendorId && vendorIds.has(String(transfer.vendorId))) return true
        return false
      })
    }
  }

  if (!transfers.length || input.reversalAmountCents <= 0) {
    return { performed: [] as any[], errors: [] as string[] }
  }

  const shares = allocateAmountAcrossLineItems(input.reversalAmountCents, transfers.map((item) => item.amountCents))
  const performed: any[] = []
  const errors: string[] = []

  for (let index = 0; index < transfers.length; index += 1) {
    const transfer = transfers[index]
    const requestedAmount = Number(shares[index] || 0)
    if (requestedAmount <= 0) continue

    try {
      const remoteTransfer = await stripe.transfers.retrieve(transfer.transferId)
      const remainingAmount = Math.max(Number((remoteTransfer as any)?.amount || transfer.amountCents) - Number((remoteTransfer as any)?.amount_reversed || 0), 0)
      const reversalAmount = Math.min(requestedAmount, remainingAmount)
      if (reversalAmount <= 0) continue

      const reversal = await stripe.transfers.createReversal(transfer.transferId, {
        amount: reversalAmount,
        metadata: {
          orderId: input.order.id,
          siteId: input.order.siteId,
          reason: input.reason,
          supportCaseId: input.supportCaseId || '',
          disputeId: input.disputeId || '',
          assetId: input.assetId || '',
        },
      }, {
        idempotencyKey: [
          'transfer-reversal',
          input.order.siteId,
          input.order.id,
          transfer.transferId,
          input.reason,
          input.disputeId || '',
          input.supportCaseId || '',
          input.assetId || '',
          String(reversalAmount),
        ].join(':').slice(0, 255),
      })

      performed.push({ transferId: transfer.transferId, reversalId: reversal.id, amountCents: reversalAmount, destination: transfer.destination })
      await createAuditLog({
        actorUserId: input.actorUserId || undefined,
        siteId: input.order.siteId,
        entityType: 'order',
        entityId: input.order.id,
        action: 'stripe.transfer.reversal.created',
        details: {
          transferId: transfer.transferId,
          reversalId: reversal.id,
          amount: reversalAmount,
          destination: transfer.destination,
          membershipId: transfer.membershipId,
          vendorId: transfer.vendorId,
          reason: input.reason,
          supportCaseId: input.supportCaseId || null,
          disputeId: input.disputeId || null,
          assetId: input.assetId || null,
        },
      })
    } catch (error: any) {
      const message = error?.message || `Transfer reversal failed for ${transfer.transferId}`
      errors.push(message)
      await createAuditLog({
        actorUserId: input.actorUserId || undefined,
        siteId: input.order.siteId,
        entityType: 'order',
        entityId: input.order.id,
        action: 'stripe.transfer.reversal.failed',
        details: {
          transferId: transfer.transferId,
          requestedAmountCents: requestedAmount,
          destination: transfer.destination,
          membershipId: transfer.membershipId,
          vendorId: transfer.vendorId,
          reason: input.reason,
          supportCaseId: input.supportCaseId || null,
          disputeId: input.disputeId || null,
          assetId: input.assetId || null,
          message,
        },
      })
    }
  }

  return { performed, errors }
}

export async function getOutstandingTransferRestoreAmount(orderId: string, siteId: string, reason: 'refund' | 'dispute' = 'dispute') {
  const [reversalLogs, restoreLogs] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        siteId,
        entityType: 'order',
        entityId: orderId,
        action: 'stripe.transfer.reversal.created',
      },
      select: { details: true },
      orderBy: { createdAt: 'asc' },
    }).catch(() => []),
    prisma.auditLog.findMany({
      where: {
        siteId,
        entityType: 'order',
        entityId: orderId,
        action: 'stripe.transfer.restore.created',
      },
      select: { details: true },
      orderBy: { createdAt: 'asc' },
    }).catch(() => []),
  ])

  const reversedAmount = reversalLogs.reduce((sum: number, log: any) => {
    const details = detailsRecord(log?.details)
    if (String(details.reason || '') !== reason) return sum
    return sum + Math.max(Number(details.amount || 0), 0)
  }, 0)

  const restoreReasons = reason === 'dispute' ? new Set(['dispute_release', 'dispute']) : new Set([reason])
  const restoredAmount = restoreLogs.reduce((sum: number, log: any) => {
    const details = detailsRecord(log?.details)
    if (!restoreReasons.has(String(details.reason || ''))) return sum
    return sum + Math.max(Number(details.amount || 0), 0)
  }, 0)

  return Math.max(reversedAmount - restoredAmount, 0)
}

export async function restoreTransfersForOrder(input: {
  order: OrderLike
  restoreAmountCents: number
  reason: 'dispute_release'
  actorUserId?: string | null
  supportCaseId?: string | null
  disputeId?: string | null
  assetId?: string | null
}) {
  if (input.restoreAmountCents <= 0) return { performed: [] as any[], errors: [] as string[] }

  const loadedOrder = await loadOrderWithItems(input.order)

  if (!loadedOrder || !Array.isArray(loadedOrder.items) || !loadedOrder.items.length) {
    return {
      performed: [] as any[],
      errors: ['Order line items were unavailable for transfer restoration.'],
    }
  }

  const payoutShares = allocateAmountAcrossLineItems(input.restoreAmountCents, scopedLineTotals(loadedOrder, input.assetId))
  return createSellerTransfersForOrder({
    order: loadedOrder,
    payoutShares,
    actorUserId: input.actorUserId || null,
    supportCaseId: input.supportCaseId || null,
    disputeId: input.disputeId || null,
    action: 'stripe.transfer.restore.created',
    failureAction: 'stripe.transfer.restore.failed',
    reason: input.reason,
  })
}

export async function syncOrderDispute(input: {
  order: any
  disputeId: string
  stage: 'created' | 'won' | 'lost'
  grossAmountCents?: number | null
  assetId?: string | null
  actorUserId?: string | null
  supportCaseId?: string | null
  notes?: string | null
}) {
  const items = Array.isArray(input.order?.items) ? input.order.items : []
  if (!items.length) {
    return {
      performed: [] as string[],
      errors: ['Order does not contain any line items for dispute reconciliation.'],
      warnings: [] as string[],
      reserveDeltaCents: 0,
      releaseDeltaCents: 0,
      nextStatus: String(input.order?.status || ''),
    }
  }

  const assetId = normalizedAssetId(input.assetId)
  const eligibleGrossCents = assetId ? grossAmountForAsset(input.order, assetId) : orderGross(input.order)
  let effectiveGrossCents = input.grossAmountCents == null
    ? eligibleGrossCents
    : Math.round(Number(input.grossAmountCents || 0))
  effectiveGrossCents = Math.min(Math.max(effectiveGrossCents, 0), eligibleGrossCents)

  if (effectiveGrossCents <= 0) {
    return {
      performed: [] as string[],
      errors: ['Dispute amount must be greater than zero for reconciliation.'],
      warnings: [] as string[],
      reserveDeltaCents: 0,
      releaseDeltaCents: 0,
      nextStatus: String(input.order?.status || ''),
    }
  }

  const gross = Math.max(orderGross(input.order), 1)
  const reserveTargetCents = Math.round((Number(input.order.vendorPayoutCents || 0) * effectiveGrossCents) / gross)
  const baseLineTotals = scopedLineTotals(input.order, assetId)
  const performed: string[] = []
  const errors: string[] = []
  const warnings: string[] = []

  const [existingReserveCents, existingReleaseCents] = await Promise.all([
    getRecordedDisputeAmountCents(input.order.id, input.disputeId, 'DISPUTE_RESERVE'),
    getRecordedDisputeAmountCents(input.order.id, input.disputeId, 'DISPUTE_RELEASE'),
  ])

  let reserveDeltaCents = 0
  let releaseDeltaCents = 0
  let reversalOutcome = { performed: [] as any[], errors: [] as string[] }
  let restoreOutcome = { performed: [] as any[], errors: [] as string[] }

  if (input.stage === 'created' || input.stage === 'lost') {
    reserveDeltaCents = Math.max(reserveTargetCents - existingReserveCents, 0)
    if (reserveDeltaCents > 0) {
      const reserveShares = allocateAmountAcrossLineItems(reserveDeltaCents, baseLineTotals)
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        if (!reserveShares[index]) continue
        await prisma.vendorLedgerEntry.create({
          data: {
            vendorId: item.asset.vendorId,
            siteId: input.order.siteId,
            vendorSiteMembershipId: item.asset.vendorSiteMembershipId || undefined,
            orderId: input.order.id,
            assetId: item.assetId,
            type: 'DISPUTE_RESERVE',
            amountCents: -Math.abs(reserveShares[index]),
            currency: item.asset.currency || input.order.currency || 'USD',
            notes: input.notes || 'Dispute reserve held',
            metadata: {
              disputeId: input.disputeId,
              disputeGrossAmountCents: effectiveGrossCents,
              reserveTargetCents,
              supportCaseId: input.supportCaseId || null,
              assetId,
            } as any,
          },
        }).catch(() => null)
      }
      performed.push('dispute_hold')
      reversalOutcome = await reverseTransfersForOrder({
        order: input.order,
        reversalAmountCents: reserveDeltaCents,
        reason: 'dispute',
        actorUserId: input.actorUserId || null,
        supportCaseId: input.supportCaseId || null,
        disputeId: input.disputeId,
        assetId,
      })
      errors.push(...reversalOutcome.errors)
    }
  }

  if (input.stage === 'won') {
    releaseDeltaCents = Math.max(existingReserveCents - existingReleaseCents, 0)
    if (releaseDeltaCents > 0) {
      const releaseShares = allocateAmountAcrossLineItems(releaseDeltaCents, baseLineTotals)
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        if (!releaseShares[index]) continue
        await prisma.vendorLedgerEntry.create({
          data: {
            vendorId: item.asset.vendorId,
            siteId: input.order.siteId,
            vendorSiteMembershipId: item.asset.vendorSiteMembershipId || undefined,
            orderId: input.order.id,
            assetId: item.assetId,
            type: 'DISPUTE_RELEASE',
            amountCents: Math.abs(releaseShares[index]),
            currency: item.asset.currency || input.order.currency || 'USD',
            notes: input.notes || 'Dispute reserve released',
            metadata: {
              disputeId: input.disputeId,
              disputeGrossAmountCents: effectiveGrossCents,
              reserveTargetCents,
              supportCaseId: input.supportCaseId || null,
              assetId,
            } as any,
          },
        }).catch(() => null)
      }
      performed.push('dispute_release')
      const outstandingRestoreAmountCents = await getOutstandingTransferRestoreAmount(input.order.id, input.order.siteId, 'dispute')
      const restoreAmountCents = Math.min(releaseDeltaCents, outstandingRestoreAmountCents)
      if (restoreAmountCents > 0) {
        restoreOutcome = await restoreTransfersForOrder({
          order: input.order,
          restoreAmountCents,
          actorUserId: input.actorUserId || null,
          supportCaseId: input.supportCaseId || null,
          disputeId: input.disputeId,
          reason: 'dispute_release',
          assetId,
        })
        errors.push(...restoreOutcome.errors)
      }
    }
  }

  const nextStatus = input.stage === 'created'
    ? 'disputed'
    : input.stage === 'lost'
      ? 'dispute_lost'
      : await resolveOrderStatusAfterDispute(input.order)

  await prisma.order.update({
    where: { id: input.order.id },
    data: { status: nextStatus },
  }).catch(() => null)

  if (input.stage === 'created') performed.push('dispute_opened')
  if (input.stage === 'lost') performed.push('dispute_lost')
  if (input.stage === 'won' && !performed.includes('dispute_release')) performed.push('dispute_won')

  await createAuditLog({
    actorUserId: input.actorUserId || undefined,
    siteId: input.order.siteId,
    entityType: 'order',
    entityId: input.order.id,
    action: input.stage === 'created' ? 'charge.dispute.created' : 'charge.dispute.closed',
    details: {
      disputeId: input.disputeId,
      amount: effectiveGrossCents,
      nextStatus,
      won: input.stage === 'won',
      reserveTargetCents,
      existingReserveCents,
      existingReleaseCents,
      reserveDeltaCents,
      releaseDeltaCents,
      transferReversalCount: reversalOutcome.performed.length,
      transferReversalAmountCents: reversalOutcome.performed.reduce((sum: number, item: any) => sum + Number(item.amountCents || 0), 0),
      transferReversalErrors: reversalOutcome.errors,
      transferRestoreCount: restoreOutcome.performed.length,
      transferRestoreAmountCents: restoreOutcome.performed.reduce((sum: number, item: any) => sum + Number(item.amountCents || 0), 0),
      transferRestoreErrors: restoreOutcome.errors,
      assetId,
      supportCaseId: input.supportCaseId || null,
      notes: input.notes || null,
    },
  })

  return {
    performed,
    errors,
    warnings,
    reserveDeltaCents,
    releaseDeltaCents,
    transferReversalAmountCents: reversalOutcome.performed.reduce((sum: number, item: any) => sum + Number(item.amountCents || 0), 0),
    transferRestoreAmountCents: restoreOutcome.performed.reduce((sum: number, item: any) => sum + Number(item.amountCents || 0), 0),
    nextStatus,
  }
}
