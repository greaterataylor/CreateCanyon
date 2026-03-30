import { listSupportCasesForSite, normalizeSupportStatus } from '@/lib/support'
import { currencyAmount } from '@/lib/utils'
import { prisma } from '@/lib/prisma'

type SupportCaseViewType = 'refund' | 'dispute' | 'takedown'

type ActionOption = { value: string; label: string }

function actionOptionsFor(type: SupportCaseViewType): ActionOption[] {
  if (type === 'refund') {
    return [
      { value: '', label: 'No action' },
      { value: 'refund', label: 'Refund in full' },
      { value: 'partial_refund', label: 'Partial refund' },
    ]
  }

  if (type === 'dispute') {
    return [
      { value: '', label: 'No action' },
      { value: 'freeze_downloads', label: 'Freeze downloads' },
      { value: 'dispute_hold', label: 'Hold dispute reserve' },
      { value: 'dispute_release', label: 'Release reserve / seller won' },
      { value: 'dispute_lost', label: 'Finalize seller loss' },
      { value: 'refund', label: 'Refund in full' },
      { value: 'partial_refund', label: 'Partial refund' },
    ]
  }

  return [
    { value: '', label: 'No action' },
    { value: 'freeze_downloads', label: 'Freeze downloads' },
    { value: 'takedown', label: 'Takedown listing' },
    { value: 'reinstate', label: 'Reinstate listing' },
  ]
}

function amountLabelFor(type: SupportCaseViewType) {
  if (type === 'refund') return 'Partial refund amount (cents)'
  if (type === 'dispute') return 'Amount override (cents)'
  return 'Action amount (optional)'
}

function amountHintFor(type: SupportCaseViewType) {
  if (type === 'refund') return 'Used only for partial refunds.'
  if (type === 'dispute') return 'Optional gross amount for dispute reserve or release. Leave blank to use the order or asset amount.'
  return 'Leave blank unless the selected action uses it.'
}

function flashMessage(state: string | null | undefined, message: string | null | undefined) {
  if (message) return message
  if (state === 'action_applied') return 'Support case action applied.'
  if (state === 'action_failed') return 'The support action was not fully applied. Case status was left unchanged.'
  if (state === 'updated') return 'Support case updated.'
  if (state === 'invalid') return 'The submitted support case update was invalid.'
  return null
}

export default async function AdminSupportCases({
  siteId,
  type,
  title,
  redirectTo,
  flashState,
  flashCaseId,
  flashMessageText,
}: {
  siteId: string
  type: SupportCaseViewType
  title: string
  redirectTo: string
  flashState?: string | null
  flashCaseId?: string | null
  flashMessageText?: string | null
}) {
  let records = await listSupportCasesForSite(siteId, type)
  if (!records.length) {
    const auditRecords = await prisma.auditLog.findMany({ where: { siteId, entityType: 'support_case', action: { startsWith: `support.${type}.` } }, orderBy: { createdAt: 'desc' }, take: 100 })
    const orderIds = auditRecords.map((record: any) => (record.details as any)?.orderId).filter(Boolean)
    const assetIds = auditRecords.map((record: any) => (record.details as any)?.assetId).filter(Boolean)
    const [orders, assets] = await Promise.all([
      orderIds.length ? prisma.order.findMany({ where: { id: { in: orderIds } } }) : Promise.resolve([]),
      assetIds.length ? prisma.asset.findMany({ where: { id: { in: assetIds } }, include: { vendor: true } }) : Promise.resolve([]),
    ])
    records = auditRecords.map((record: any) => ({
      id: record.id,
      type: String((record.details as any)?.type || type).toUpperCase(),
      status: String((record.details as any)?.status || 'open').toUpperCase(),
      message: String((record.details as any)?.message || ''),
      actionMode: String((record.details as any)?.actionMode || ''),
      resolutionNotes: String((record.details as any)?.resolutionNotes || ''),
      counterNoticeText: String((record.details as any)?.counterNoticeText || ''),
      counterNoticeAt: null,
      createdAt: record.createdAt,
      order: orders.find((item: any) => item.id === (record.details as any)?.orderId),
      asset: assets.find((item: any) => item.id === (record.details as any)?.assetId),
      reporter: null,
    })) as any
  }

  const flash = flashMessage(flashState, flashMessageText)
  const actionOptions = actionOptionsFor(type)
  const flashClass = flashState === 'action_failed' || flashState === 'invalid'
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-emerald-200 bg-emerald-50 text-emerald-900'

  return (
    <div className="space-y-6">
      <div className="space-y-2"><h1 className="text-2xl font-bold">{title}</h1><p className="text-gray-600">Queue of user-submitted {type} cases for this marketplace.</p></div>
      {flash && <div className={`rounded-lg border px-4 py-3 text-sm ${flashClass}`}>{flash}{flashCaseId ? ` Case ${flashCaseId}.` : ''}</div>}
      {records.length ? records.map((record: any) => {
        const status = normalizeSupportStatus(String(record.status || '').toLowerCase())
        return (
          <div key={record.id} className="card">
            <form action={`/api/admin/support/${record.id}`} method="POST" className="card-body space-y-4">
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-semibold">{record.asset?.title || 'Unknown asset'}</div>
                  <div className="text-sm text-gray-500">Case {record.id} • Submitted {record.createdAt ? new Date(record.createdAt).toDateString() : '—'}</div>
                  {record.asset && <div className="text-sm text-gray-500">Seller: {record.asset.vendor?.displayName || 'Unknown seller'}</div>}
                  {record.reporter && <div className="text-sm text-gray-500">Buyer: {record.reporter.email || record.reporter.name || record.reporter.id}</div>}
                  {record.order && <div className="text-sm text-gray-500">Order total ${currencyAmount(record.order.totalCents)} • Status {record.order.status}</div>}
                </div>
                <div className="badge">{status.replace(/_/g, ' ')}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm whitespace-pre-wrap">{String(record.message || '')}</div>
              {record.counterNoticeText && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700"><div className="font-medium">Seller counter-notice</div><div className="mt-1 whitespace-pre-wrap">{record.counterNoticeText}</div></div>}
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <label className="label">Status</label>
                  <select className="input" name="status" defaultValue={status}>
                    <option value="open">Open</option>
                    <option value="in_review">In review</option>
                    <option value="resolved">Resolved</option>
                    <option value="rejected">Rejected</option>
                    <option value="counter_notice_received">Counter notice received</option>
                    <option value="released">Released</option>
                  </select>
                </div>
                <div>
                  <label className="label">Action mode</label>
                  <select className="input" name="actionMode" defaultValue={String(record.actionMode || '')}>
                    {actionOptions.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{amountLabelFor(type)}</label>
                  <input className="input" name="amountCents" type="number" min={1} step={1} placeholder={record.order ? String(record.order.totalCents) : 'Optional'} />
                  <div className="mt-1 text-xs text-gray-500">{amountHintFor(type)}</div>
                </div>
                <div>
                  <label className="label">Resolution notes</label>
                  <textarea className="input min-h-24" name="resolutionNotes" defaultValue={String(record.resolutionNotes || '')} />
                </div>
              </div>
              <button className="btn" type="submit">Update case</button>
            </form>
          </div>
        )
      }) : <div className="empty-state">No {type} cases yet.</div>}
    </div>
  )
}
