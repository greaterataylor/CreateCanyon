import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function AdminReportsPage() {
  const site = await getActiveSite()
  await requireAdminForSite(site.id)

  const [assetsCount, approvedAssets, vendorsApproved, paidOrders, gross, sales, supportCases, suspiciousCount, ledgerEntries] = await Promise.all([
    prisma.asset.count({ where: { siteId: site.id } }),
    prisma.asset.count({ where: { siteId: site.id, status: 'APPROVED' } }),
    prisma.vendorSiteMembership.count({ where: { siteId: site.id, status: 'APPROVED' } }),
    prisma.order.count({ where: { siteId: site.id, status: 'paid' } }),
    prisma.order.aggregate({ where: { siteId: site.id, status: 'paid' }, _sum: { totalCents: true, platformFeeCents: true, vendorPayoutCents: true, taxCents: true } }),
    prisma.orderItem.findMany({ where: { asset: { siteId: site.id }, order: { status: 'paid' } }, include: { asset: { include: { vendor: true, category: true } }, order: true } }),
    prisma.supportCase.groupBy({ by: ['type', 'status'], where: { siteId: site.id }, _count: true }),
    prisma.auditLog.count({ where: { siteId: site.id, action: { startsWith: 'suspicious.' } } }),
    prisma.vendorLedgerEntry.findMany({ where: { siteId: site.id }, orderBy: { createdAt: 'desc' }, take: 500 }),
  ])

  const topAssets = new Map<string, { name: string; seller: string; category: string; gross: number; units: number }>()
  const topVendors = new Map<string, { name: string; gross: number }>()
  const topCategories = new Map<string, { name: string; gross: number }>()
  for (const sale of sales as any[]) {
    const grossValue = sale.priceCents * sale.quantity
    const assetRow = topAssets.get(sale.assetId) || { name: sale.asset.title, seller: sale.asset.vendor.displayName, category: sale.asset.category.name, gross: 0, units: 0 }
    assetRow.gross += grossValue
    assetRow.units += sale.quantity
    topAssets.set(sale.assetId, assetRow)

    const vendorRow = topVendors.get(sale.asset.vendorId) || { name: sale.asset.vendor.displayName, gross: 0 }
    vendorRow.gross += grossValue
    topVendors.set(sale.asset.vendorId, vendorRow)

    const categoryRow = topCategories.get(sale.asset.categoryId) || { name: sale.asset.category.name, gross: 0 }
    categoryRow.gross += grossValue
    topCategories.set(sale.asset.categoryId, categoryRow)
  }

  const supportSummary = supportCases.reduce((acc: Record<string, number>, item: any) => {
    acc[`${item.type}:${item.status}`] = item._count
    return acc
  }, {})
  const payoutLedger = ledgerEntries.filter((entry: any) => entry.type === 'VENDOR_PAYOUT').reduce((sum: number, entry: any) => sum + Number(entry.amountCents || 0), 0)
  const refundLedger = ledgerEntries.filter((entry: any) => entry.type === 'REFUND').reduce((sum: number, entry: any) => sum + Math.abs(Number(entry.amountCents || 0)), 0)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Marketplace reports</h1>
        <p className="text-gray-600">Operational snapshot for {site.name} using live marketplace, tax, support, and audit tables.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="kv-item"><div className="text-sm text-gray-500">Assets</div><div className="mt-2 text-3xl font-bold">{assetsCount}</div><div className="text-xs text-gray-500">Approved: {approvedAssets}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Approved vendors</div><div className="mt-2 text-3xl font-bold">{vendorsApproved}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Paid orders</div><div className="mt-2 text-3xl font-bold">{paidOrders}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Gross merchandise volume</div><div className="mt-2 text-3xl font-bold">${currencyAmount(gross._sum.totalCents || 0)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Suspicious events</div><div className="mt-2 text-3xl font-bold">{suspiciousCount}</div></div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="kv-item"><div className="text-sm text-gray-500">Platform fees</div><div className="mt-2 text-3xl font-bold">${currencyAmount(gross._sum.platformFeeCents || 0)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Vendor payouts</div><div className="mt-2 text-3xl font-bold">${currencyAmount(payoutLedger || gross._sum.vendorPayoutCents || 0)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Collected tax</div><div className="mt-2 text-3xl font-bold">${currencyAmount(gross._sum.taxCents || 0)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Refund adjustments</div><div className="mt-2 text-3xl font-bold">${currencyAmount(refundLedger)}</div></div>
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <section className="card"><div className="card-body space-y-3"><h2 className="font-semibold">Top-selling assets</h2>{Array.from(topAssets.values()).length ? Array.from(topAssets.values()).sort((a, b) => b.gross - a.gross).slice(0, 5).map((asset) => <div key={asset.name} className="rounded-lg border border-gray-200 p-3"><div className="font-medium">{asset.name}</div><div className="text-sm text-gray-500">{asset.seller} • {asset.category}</div><div className="text-sm text-gray-600">Gross ${currencyAmount(asset.gross)} • Units {asset.units}</div></div>) : <div className="empty-state">No paid sales yet.</div>}</div></section>
        <section className="card"><div className="card-body space-y-3"><h2 className="font-semibold">Top vendors</h2>{Array.from(topVendors.values()).length ? Array.from(topVendors.values()).sort((a, b) => b.gross - a.gross).slice(0, 5).map((vendor) => <div key={vendor.name} className="rounded-lg border border-gray-200 p-3"><div className="font-medium">{vendor.name}</div><div className="text-sm text-gray-600">Gross ${currencyAmount(vendor.gross)}</div></div>) : <div className="empty-state">No vendor sales yet.</div>}</div></section>
        <section className="card"><div className="card-body space-y-3"><h2 className="font-semibold">Top categories</h2>{Array.from(topCategories.values()).length ? Array.from(topCategories.values()).sort((a, b) => b.gross - a.gross).slice(0, 5).map((category) => <div key={category.name} className="rounded-lg border border-gray-200 p-3"><div className="font-medium">{category.name}</div><div className="text-sm text-gray-600">Gross ${currencyAmount(category.gross)}</div></div>) : <div className="empty-state">No category sales yet.</div>}</div></section>
      </div>
      <section className="card">
        <div className="card-body space-y-3">
          <h2 className="font-semibold">Support and compliance snapshot</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 text-sm text-gray-600">
            {Object.keys(supportSummary).length ? Object.entries(supportSummary).map(([key, count]) => <div key={key} className="rounded-lg border border-gray-200 p-3"><div className="font-medium">{key.replace(':', ' • ')}</div><div className="mt-1">{Number(count)} case(s)</div></div>) : <div className="rounded-lg border border-gray-200 p-3">No support cases yet.</div>}
          </div>
        </div>
      </section>
    </div>
  )
}
