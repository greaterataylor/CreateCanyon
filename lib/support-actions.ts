import { prisma } from './prisma'
import { createAuditLog } from './audit'
import { createSupportRefund } from './finance'
import { syncOrderDispute } from './payments'

export type SupportActionMode = '' | 'refund' | 'partial_refund' | 'freeze_downloads' | 'reinstate' | 'takedown' | 'dispute_hold' | 'dispute_release' | 'dispute_lost'

export type SupportActionOutcome = {
  performed: string[]
  errors: string[]
  warnings: string[]
  refundId: string | null
}

export function normalizeSupportActionMode(value: string | null | undefined): SupportActionMode {
  if (value === 'refund' || value === 'partial_refund' || value === 'freeze_downloads' || value === 'reinstate' || value === 'takedown' || value === 'dispute_hold' || value === 'dispute_release' || value === 'dispute_lost') return value
  return ''
}

export function allowedSupportActionsForCaseType(supportCaseType: string | null | undefined): SupportActionMode[] {
  const type = String(supportCaseType || '').trim().toLowerCase()
  if (type === 'refund') return ['', 'refund', 'partial_refund']
  if (type === 'dispute') return ['', 'freeze_downloads', 'takedown', 'reinstate', 'refund', 'partial_refund', 'dispute_hold', 'dispute_release', 'dispute_lost']
  if (type === 'takedown') return ['', 'freeze_downloads', 'takedown', 'reinstate']
  return ['']
}

export function isSupportActionAllowedForCaseType(supportCaseType: string | null | undefined, actionMode: SupportActionMode) {
  return allowedSupportActionsForCaseType(supportCaseType).includes(actionMode)
}

function mergeNotes(existing: string | null | undefined, addition: string) {
  const trimmedExisting = String(existing || '').trim()
  const trimmedAddition = addition.trim()
  if (!trimmedAddition) return trimmedExisting || null
  return [trimmedExisting, trimmedAddition].filter(Boolean).join('\n\n').slice(0, 4000)
}

export async function executeSupportAction(input: {
  siteId: string
  actorUserId: string
  supportCaseId?: string | null
  supportCaseType?: string | null
  actionMode?: string | null
  assetId?: string | null
  orderId?: string | null
  resolutionNotes?: string | null
  amountCents?: number | null
}): Promise<SupportActionOutcome> {
  const actionMode = normalizeSupportActionMode(input.actionMode)
  if (!actionMode) return { performed: [], errors: [], warnings: [], refundId: null }
  if (!isSupportActionAllowedForCaseType(input.supportCaseType, actionMode)) {
    return {
      performed: [],
      errors: [`The ${actionMode.replace(/_/g, ' ')} action is not allowed for ${String(input.supportCaseType || 'this')} cases.`],
      warnings: [],
      refundId: null,
    }
  }

  const performed: string[] = []
  const errors: string[] = []
  const warnings: string[] = []
  let refundId: string | null = null

  const asset = input.assetId
    ? await prisma.asset.findFirst({ where: { id: input.assetId, siteId: input.siteId } }).catch(() => null)
    : null
  const order = input.orderId
    ? await prisma.order.findFirst({ where: { id: input.orderId, siteId: input.siteId } }).catch(() => null)
    : null

  if (actionMode === 'freeze_downloads') {
    if (!asset) {
      errors.push('Asset not found for download freeze.')
    } else {
      const complianceNote = mergeNotes(asset.complianceNotes, input.resolutionNotes || 'Downloads frozen by admin support review.')
      await prisma.asset.update({
        where: { id: asset.id },
        data: {
          downloadsDisabled: true,
          complianceNotes: complianceNote || undefined,
        },
      })
      performed.push('freeze_downloads')
      await createAuditLog({ actorUserId: input.actorUserId, siteId: input.siteId, entityType: 'asset', entityId: asset.id, action: 'asset.downloads.frozen', details: { supportCaseId: input.supportCaseId || null } })
    }
  }

  if (actionMode === 'takedown') {
    if (!asset) {
      errors.push('Asset not found for takedown.')
    } else {
      const rejectionReason = input.resolutionNotes || 'Listing removed during takedown/compliance review.'
      const complianceNote = mergeNotes(asset.complianceNotes, `Takedown action applied.${input.resolutionNotes ? ` ${input.resolutionNotes}` : ''}`)
      await prisma.asset.update({
        where: { id: asset.id },
        data: {
          downloadsDisabled: true,
          status: 'REJECTED',
          rejectionReason,
          complianceNotes: complianceNote || undefined,
        },
      })
      performed.push('takedown')
      await createAuditLog({ actorUserId: input.actorUserId, siteId: input.siteId, entityType: 'asset', entityId: asset.id, action: 'asset.taken_down', details: { supportCaseId: input.supportCaseId || null } })
    }
  }

  if (actionMode === 'reinstate') {
    if (!asset) {
      errors.push('Asset not found for reinstatement.')
    } else {
      const complianceNote = mergeNotes(asset.complianceNotes, `Listing reinstated.${input.resolutionNotes ? ` ${input.resolutionNotes}` : ''}`)
      await prisma.asset.update({
        where: { id: asset.id },
        data: {
          downloadsDisabled: false,
          status: asset.status === 'ARCHIVED' || asset.status === 'REJECTED' ? 'APPROVED' : asset.status,
          rejectionReason: null,
          complianceNotes: complianceNote || undefined,
        },
      })
      performed.push('reinstate')
      await createAuditLog({ actorUserId: input.actorUserId, siteId: input.siteId, entityType: 'asset', entityId: asset.id, action: 'asset.reinstated', details: { supportCaseId: input.supportCaseId || null } })
    }
  }

  if (actionMode === 'refund' || actionMode === 'partial_refund') {
    if (!order) {
      errors.push('Order not found for refund.')
    } else {
      const requestedAmount = actionMode === 'partial_refund' ? Math.round(Number(input.amountCents || 0)) : null
      if (actionMode === 'partial_refund' && (!requestedAmount || requestedAmount <= 0)) {
        errors.push('A positive refund amount in cents is required for a partial refund.')
      } else {
        try {
          const refund = await createSupportRefund({
            siteId: input.siteId,
            caseId: input.supportCaseId || order.id,
            orderId: order.id,
            assetId: input.assetId || null,
            requestedByUserId: input.actorUserId,
            refundMode: actionMode,
            refundAmountCents: requestedAmount,
            resolutionNotes: input.resolutionNotes || null,
          })
          refundId = refund.refundId
          performed.push(actionMode)
        } catch (error: any) {
          errors.push(error?.message || 'Refund failed.')
        }
      }
    }
  }

  if (actionMode === 'dispute_hold' || actionMode === 'dispute_release' || actionMode === 'dispute_lost') {
    const fullOrder = input.orderId
      ? await prisma.order.findFirst({
          where: { id: input.orderId, siteId: input.siteId },
          include: {
            items: {
              include: {
                asset: { include: { vendorSiteMembership: true } },
              },
            },
          },
        }).catch(() => null)
      : null

    if (!fullOrder) {
      errors.push('Order not found for dispute reconciliation.')
    } else {
      const disputeId = `support:${input.supportCaseId || fullOrder.id}`
      const disputeResult = await syncOrderDispute({
        order: fullOrder,
        disputeId,
        grossAmountCents: input.amountCents ?? null,
        assetId: input.assetId || null,
        actorUserId: input.actorUserId,
        supportCaseId: input.supportCaseId || null,
        notes: input.resolutionNotes || null,
        stage: actionMode === 'dispute_hold' ? 'created' : actionMode === 'dispute_release' ? 'won' : 'lost',
      })
      errors.push(...disputeResult.errors)
      warnings.push(...disputeResult.warnings)
      if (!disputeResult.errors.length) {
        performed.push(actionMode)
        await createAuditLog({
          actorUserId: input.actorUserId,
          siteId: input.siteId,
          entityType: 'support_case',
          entityId: input.supportCaseId || fullOrder.id,
          action: `support-case.action.${actionMode}.applied`,
          details: {
            orderId: fullOrder.id,
            assetId: input.assetId || null,
            disputeId,
            reserveDeltaCents: disputeResult.reserveDeltaCents,
            releaseDeltaCents: disputeResult.releaseDeltaCents,
            nextStatus: disputeResult.nextStatus,
            warnings: disputeResult.warnings,
          },
        })
      }
    }
  }

  return { performed, errors, warnings, refundId }
}
