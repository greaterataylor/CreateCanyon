import { syncOrderDispute } from './payments'

type DisputeAction = 'hold' | 'release' | 'lost'

export async function applyDisputeAction(input: {
  order: any
  action: DisputeAction
  grossAmountCents?: number | null
  disputeId?: string | null
  actorUserId?: string | null
  supportCaseId?: string | null
  resolutionNotes?: string | null
  source: 'stripe_webhook' | 'admin_support'
}) {
  const result = await syncOrderDispute({
    order: input.order,
    disputeId: input.disputeId || `dispute:${input.order?.id || 'order'}`,
    grossAmountCents: input.grossAmountCents ?? null,
    actorUserId: input.actorUserId || null,
    supportCaseId: input.supportCaseId || null,
    notes: input.resolutionNotes || null,
    stage: input.action === 'hold' ? 'created' : input.action === 'release' ? 'won' : 'lost',
  })

  return {
    performed: result.performed,
    warnings: result.warnings,
    deltaReservePayoutCents: result.reserveDeltaCents,
    deltaReleasePayoutCents: result.releaseDeltaCents,
    transferReversalAmountCents: result.transferReversalAmountCents || 0,
    transferRestoreAmountCents: result.transferRestoreAmountCents || 0,
    nextStatus: result.nextStatus,
    source: input.source,
  }
}
