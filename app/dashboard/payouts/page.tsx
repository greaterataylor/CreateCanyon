import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { getVendorLedgerSummary } from '@/lib/ledger'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function detailsRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function formatAuditAmount(details: Record<string, unknown>) {
  const raw = details.amount ?? details.amountCents ?? details.requestedAmountCents
  const amount = Number(raw || 0)
  if (!Number.isFinite(amount) || !amount) return null
  return `$${currencyAmount(Math.abs(amount))}`
}

function payoutAuditSummary(entry: any) {
  const details = detailsRecord(entry.details)
  const amount = formatAuditAmount(details)
  if (entry.action === 'stripe.payout.created') return amount ? `Stripe created a payout for ${amount}.` : 'Stripe created a payout.'
  if (entry.action === 'stripe.payout.updated') return amount ? `Payout status updated for ${amount}.` : 'Payout status updated.'
  if (entry.action === 'stripe.payout.paid') return amount ? `Payout of ${amount} reached your bank.` : 'Payout reached your bank.'
  if (entry.action === 'stripe.payout.failed') return amount ? `Payout of ${amount} failed.` : 'Payout failed.'
  if (entry.action === 'stripe.payout.canceled') return amount ? `Payout of ${amount} was canceled.` : 'Payout was canceled.'
  if (entry.action === 'stripe.payout.balance_deducted') return amount ? `Available balance reduced by ${amount} after settlement.` : 'Available balance reduced after settlement.'
  if (entry.action === 'stripe.payout.balance_restored') return amount ? `Available balance restored by ${amount} after payout reversal.` : 'Available balance restored after payout reversal.'
  if (entry.action === 'stripe.account.updated') return 'Stripe Connect account status updated.'
  return 'Payout activity updated.'
}

function transferAuditSummary(entry: any) {
  const details = detailsRecord(entry.details)
  const amount = formatAuditAmount(details)
  const reason = String(details.reason || '')

  if (entry.action === 'stripe.transfer.created') {
    return amount ? `Transferred ${amount} into your connected Stripe account.` : 'Transferred funds into your connected Stripe account.'
  }
  if (entry.action === 'stripe.transfer.reversal.created') {
    if (reason === 'refund') return amount ? `Reversed ${amount} from seller transfers to cover a refund.` : 'Reversed seller transfers to cover a refund.'
    if (reason === 'dispute') return amount ? `Reversed ${amount} from seller transfers into dispute reserve.` : 'Reversed seller transfers into dispute reserve.'
    return amount ? `Reversed ${amount} from a previous seller transfer.` : 'Reversed a previous seller transfer.'
  }
  if (entry.action === 'stripe.transfer.restore.created') {
    if (reason === 'dispute_release') return amount ? `Returned ${amount} to seller transfers after the dispute was released.` : 'Returned seller transfers after the dispute was released.'
    return amount ? `Restored ${amount} to seller transfers.` : 'Restored seller transfers.'
  }
  if (entry.action === 'stripe.transfer.failed') {
    return amount ? `Transfer of ${amount} failed.` : 'Seller transfer failed.'
  }
  if (entry.action === 'stripe.transfer.reversal.failed') {
    return amount ? `Transfer reversal for ${amount} failed.` : 'Transfer reversal failed.'
  }
  if (entry.action === 'stripe.transfer.restore.failed') {
    return amount ? `Transfer restore for ${amount} failed.` : 'Transfer restore failed.'
  }
  if (entry.action === 'refund.requested') {
    return amount ? `Refund requested for ${amount}.` : 'Refund requested.'
  }
  if (entry.action === 'refund.request.failed') {
    return 'Refund request failed.'
  }
  if (entry.action === 'charge.refunded') {
    const delta = Number(details.refundDeltaVendorPayoutCents || 0)
    return delta > 0 ? `Refund settled. Seller balance adjusted by $${currencyAmount(delta)}.` : 'Refund settled with no new seller balance change.'
  }
  if (entry.action === 'charge.dispute.created') {
    const delta = Number(details.reserveDeltaVendorPayoutCents || 0)
    return delta > 0 ? `Dispute reserve created. Seller balance held by $${currencyAmount(delta)}.` : 'Dispute reserve recorded.'
  }
  if (entry.action === 'charge.dispute.closed') {
    const released = Number(details.releaseDeltaVendorPayoutCents || 0)
    if (String(details.nextStatus || '') === 'dispute_lost') return 'Dispute closed as lost. Reserved seller balance remains deducted.'
    return released > 0 ? `Dispute closed and $${currencyAmount(released)} was released back to seller balance.` : 'Dispute closed with no new seller balance change.'
  }
  return 'Payment activity updated.'
}

function ledgerEntryLabel(entry: any) {
  const metadata = detailsRecord(entry.metadata)
  if (entry.type === 'ADJUSTMENT' && metadata.kind === 'stripe_payout_paid') return 'BANK PAYOUT'
  if (entry.type === 'ADJUSTMENT' && metadata.kind === 'stripe_payout_restored') return 'PAYOUT REVERSAL'
  return String(entry.type || '').replace(/_/g, ' ')
}

function ledgerEntryNotes(entry: any) {
  const metadata = detailsRecord(entry.metadata)
  if (metadata.kind === 'stripe_payout_paid') return 'Stripe payout settled to bank'
  if (metadata.kind === 'stripe_payout_restored') return 'Stripe returned payout to available balance'
  return entry.notes || 'Ledger activity'
}

export default async function PayoutsPage() {
  const user = await currentUser()
  if (!user?.vendor) return <div className="empty-state">Create or apply for a seller profile first.</div>

  const site = await getActiveSite()
  const membership = user.vendor.memberships.find((item: any) => item.siteId === site.id)
  if (!membership) return <div className="empty-state">You do not have a seller membership for this marketplace yet.</div>

  const ledger = await getVendorLedgerSummary(user.vendor.id, site.id)
  const payoutEntries = ledger.entries.filter((entry: any) => ['VENDOR_PAYOUT', 'REFUND', 'DISPUTE_RESERVE', 'DISPUTE_RELEASE', 'ADJUSTMENT'].includes(String(entry.type || '')))
  const accruedSellerNet = payoutEntries.filter((entry: any) => entry.type === 'VENDOR_PAYOUT').reduce((sum: number, entry: any) => sum + Number(entry.amountCents || 0), 0)
  const reserves = payoutEntries.filter((entry: any) => entry.type === 'DISPUTE_RESERVE').reduce((sum: number, entry: any) => sum + Math.abs(Number(entry.amountCents || 0)), 0)
  const refunds = payoutEntries.filter((entry: any) => entry.type === 'REFUND').reduce((sum: number, entry: any) => sum + Math.abs(Number(entry.amountCents || 0)), 0)
  const settledToBank = payoutEntries.reduce((sum: number, entry: any) => {
    const metadata = detailsRecord(entry.metadata)
    if (entry.type !== 'ADJUSTMENT' || metadata.kind !== 'stripe_payout_paid') return sum
    return sum + Math.abs(Number(entry.amountCents || 0))
  }, 0)
  const payoutRestores = payoutEntries.reduce((sum: number, entry: any) => {
    const metadata = detailsRecord(entry.metadata)
    if (entry.type !== 'ADJUSTMENT' || metadata.kind !== 'stripe_payout_restored') return sum
    return sum + Math.abs(Number(entry.amountCents || 0))
  }, 0)

  const relatedOrderIds = Array.from(new Set(ledger.entries.map((entry: any) => String(entry.orderId || '')).filter(Boolean))).slice(0, 100)
  const [transferActivity, payoutLifecycle] = await Promise.all([
    relatedOrderIds.length
      ? prisma.auditLog.findMany({
          where: {
            siteId: site.id,
            entityType: 'order',
            entityId: { in: relatedOrderIds },
            action: {
              in: [
                'stripe.transfer.created',
                'stripe.transfer.failed',
                'stripe.transfer.reversal.created',
                'stripe.transfer.reversal.failed',
                'stripe.transfer.restore.created',
                'stripe.transfer.restore.failed',
                'refund.requested',
                'refund.request.failed',
                'charge.refunded',
                'charge.dispute.created',
                'charge.dispute.closed',
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 25,
        })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: {
        siteId: site.id,
        entityType: 'vendor_membership',
        entityId: membership.id,
        action: {
          in: [
            'stripe.account.updated',
            'stripe.payout.created',
            'stripe.payout.updated',
            'stripe.payout.paid',
            'stripe.payout.failed',
            'stripe.payout.canceled',
            'stripe.payout.balance_deducted',
            'stripe.payout.balance_restored',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ])

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Payouts &amp; balance</h1>
        <p className="text-gray-600">Accrued seller earnings, payout reconciliation, refund adjustments, and Stripe activity for {site.name}.</p>
      </div>
      <DashboardNav />

      <div className="grid gap-4 md:grid-cols-5">
        <div className="kv-item"><div className="text-sm text-gray-500">Available balance</div><div className="mt-2 text-3xl font-bold">${currencyAmount(ledger.ledgerBalanceCents)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Accrued seller net</div><div className="mt-2 text-3xl font-bold">${currencyAmount(accruedSellerNet)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Settled to bank</div><div className="mt-2 text-3xl font-bold">${currencyAmount(settledToBank)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Refund adjustments</div><div className="mt-2 text-3xl font-bold">${currencyAmount(refunds)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Dispute reserves</div><div className="mt-2 text-3xl font-bold">${currencyAmount(reserves)}</div></div>
      </div>

      <div className="card">
        <div className="card-body space-y-3">
          <h2 className="font-semibold">Stripe Connect status</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
            <div className="rounded-lg border border-gray-200 p-3"><div className="text-gray-500">Connected account</div><div className="mt-1 font-medium break-all">{membership.stripeAccountId || 'Not connected'}</div></div>
            <div className="rounded-lg border border-gray-200 p-3"><div className="text-gray-500">Account status</div><div className="mt-1 font-medium">{membership.stripeAccountStatus || 'Pending'}</div></div>
            <div className="rounded-lg border border-gray-200 p-3"><div className="text-gray-500">Charges enabled</div><div className="mt-1 font-medium">{membership.stripeChargesEnabled ? 'Yes' : 'No'}</div></div>
            <div className="rounded-lg border border-gray-200 p-3"><div className="text-gray-500">Payouts enabled</div><div className="mt-1 font-medium">{membership.stripePayoutsEnabled ? 'Yes' : 'No'}</div></div>
          </div>
          {payoutRestores > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">${currencyAmount(payoutRestores)} has been restored to your available balance from failed or canceled Stripe payouts.</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-body space-y-3">
          <h2 className="font-semibold">Payout and balance history</h2>
          {payoutEntries.length ? (
            <table className="table">
              <thead>
                <tr><th>Type</th><th>Notes</th><th>Amount</th><th>Date</th></tr>
              </thead>
              <tbody>
                {payoutEntries.slice(0, 50).map((entry: any) => (
                  <tr key={entry.id}>
                    <td>{ledgerEntryLabel(entry)}</td>
                    <td>{ledgerEntryNotes(entry)}</td>
                    <td>{Number(entry.amountCents || 0) >= 0 ? '+' : '-'}${currencyAmount(Math.abs(Number(entry.amountCents || 0)))}</td>
                    <td>{new Date(entry.createdAt).toDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty-state">No payout ledger entries yet.</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-body space-y-3">
          <h2 className="font-semibold">Recent Stripe payout lifecycle</h2>
          {payoutLifecycle.length ? (
            <table className="table">
              <thead>
                <tr><th>Event</th><th>Summary</th><th>Date</th></tr>
              </thead>
              <tbody>
                {payoutLifecycle.map((entry: any) => (
                  <tr key={entry.id}>
                    <td>{String(entry.action || '').replace(/^stripe\./, '').replace(/\./g, ' ')}</td>
                    <td>{payoutAuditSummary(entry)}</td>
                    <td>{new Date(entry.createdAt).toDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty-state">No Stripe payout lifecycle events for your connected account yet.</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-body space-y-3">
          <h2 className="font-semibold">Recent Stripe transfer activity</h2>
          {transferActivity.length ? (
            <table className="table">
              <thead>
                <tr><th>Event</th><th>Summary</th><th>Date</th></tr>
              </thead>
              <tbody>
                {transferActivity.map((entry: any) => (
                  <tr key={entry.id}>
                    <td>{String(entry.action || '').replace(/^stripe\./, '').replace(/^charge\./, '').replace(/^refund\./, '').replace(/\./g, ' ')}</td>
                    <td>{transferAuditSummary(entry)}</td>
                    <td>{new Date(entry.createdAt).toDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty-state">No recent Stripe transfer activity for your orders yet.</div>}
        </div>
      </div>
    </div>
  )
}
