import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { getVendorLedgerSummary } from '@/lib/ledger'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function SalesPage() {
  const user = await currentUser()
  if (!user?.vendor) return <div className="empty-state">Create or apply for a seller profile first.</div>

  const site = await getActiveSite()
  const membership = user.vendor.memberships.find((item: any) => item.siteId === site.id)
  if (!membership) return <div className="empty-state">You do not have a seller membership for this marketplace yet.</div>

  const [sales, assets, ledger] = await Promise.all([
    prisma.orderItem.findMany({
      where: { asset: { vendorId: user.vendor.id, siteId: site.id }, order: { status: { in: ['paid', 'refunded', 'partially_refunded', 'disputed', 'dispute_lost'] } } },
      include: { asset: true, order: true, licenseOption: true },
      orderBy: { order: { createdAt: 'desc' } },
    }),
    prisma.asset.findMany({ where: { vendorId: user.vendor.id, siteId: site.id }, include: { purchases: true }, orderBy: { createdAt: 'desc' } }),
    getVendorLedgerSummary(user.vendor.id, site.id),
  ])

  const paidSales = sales.filter((sale: any) => sale.order.status === 'paid')
  const gross = paidSales.reduce((sum: number, sale: any) => sum + sale.priceCents * sale.quantity, 0)
  const averageOrderValue = paidSales.length ? Math.round(gross / paidSales.length) : 0
  const taxTotal = ledger.entries.filter((entry: any) => entry.type === 'TAX').reduce((sum: number, entry: any) => sum + Math.abs(Number(entry.amountCents || 0)), 0)
  const feeTotal = ledger.entries.filter((entry: any) => entry.type === 'PLATFORM_FEE').reduce((sum: number, entry: any) => sum + Math.abs(Number(entry.amountCents || 0)), 0)

  const topAssets = assets
    .map((asset: any) => ({
      id: asset.id,
      title: asset.title,
      status: asset.status,
      purchases: asset.purchases.length,
      gross: paidSales.filter((sale: any) => sale.assetId === asset.id).reduce((sum: number, sale: any) => sum + sale.priceCents * sale.quantity, 0),
    }))
    .sort((a: { gross: number }, b: { gross: number }) => b.gross - a.gross)
    .slice(0, 6)

  const licenseMix = new Map<string, { name: string; units: number; gross: number }>()
  for (const sale of paidSales as any[]) {
    const key = sale.licenseOption?.id || 'standard'
    const row = licenseMix.get(key) || { name: sale.licenseOption?.name || 'Standard', units: 0, gross: 0 }
    row.units += sale.quantity
    row.gross += sale.priceCents * sale.quantity
    licenseMix.set(key, row)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Sales & analytics</h1>
        <p className="text-gray-600">Live sales, fee, tax, and ledger activity for your storefront on {site.name}.</p>
      </div>
      <DashboardNav />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="kv-item"><div className="text-sm text-gray-500">Gross sales</div><div className="mt-2 text-3xl font-bold">${currencyAmount(gross)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Estimated seller net</div><div className="mt-2 text-3xl font-bold">${currencyAmount(ledger.estimatedNetCents)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Ledger balance</div><div className="mt-2 text-3xl font-bold">${currencyAmount(ledger.ledgerBalanceCents)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Platform fees</div><div className="mt-2 text-3xl font-bold">${currencyAmount(feeTotal)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Collected tax</div><div className="mt-2 text-3xl font-bold">${currencyAmount(taxTotal)}</div></div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="kv-item"><div className="text-sm text-gray-500">Paid order items</div><div className="mt-2 text-3xl font-bold">{paidSales.length}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Average order value</div><div className="mt-2 text-3xl font-bold">${currencyAmount(averageOrderValue)}</div></div>
        <div className="kv-item"><div className="text-sm text-gray-500">Active assets</div><div className="mt-2 text-3xl font-bold">{assets.filter((asset: any) => asset.status === 'APPROVED').length}</div></div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <section className="card">
          <div className="card-body space-y-3">
            <h2 className="font-semibold">Recent order activity</h2>
            {sales.length ? (
              <table className="table">
                <thead>
                  <tr><th>Asset</th><th>License</th><th>Price</th><th>Qty</th><th>Order status</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {sales.slice(0, 20).map((sale: any) => (
                    <tr key={sale.id}>
                      <td>{sale.asset.title}</td>
                      <td>{sale.licenseOption?.name || 'Standard'}</td>
                      <td>${currencyAmount(sale.priceCents)}</td>
                      <td>{sale.quantity}</td>
                      <td>{sale.order.status}</td>
                      <td>{sale.order.createdAt.toDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty-state">No sales yet.</div>}
          </div>
        </section>

        <div className="space-y-6">
          <section className="card">
            <div className="card-body space-y-3">
              <h2 className="font-semibold">Top assets</h2>
              {topAssets.length ? topAssets.map((asset: any) => (
                <div key={asset.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="font-medium">{asset.title}</div>
                  <div className="text-sm text-gray-500">Status: {asset.status}</div>
                  <div className="text-sm text-gray-600">Gross ${currencyAmount(asset.gross)} • Purchases {asset.purchases}</div>
                </div>
              )) : <div className="empty-state">No asset metrics yet.</div>}
            </div>
          </section>

          <section className="card">
            <div className="card-body space-y-3">
              <h2 className="font-semibold">License mix</h2>
              {Array.from(licenseMix.values()).length ? Array.from(licenseMix.values()).sort((a: { gross: number }, b: { gross: number }) => b.gross - a.gross).map((item) => (
                <div key={item.name} className="rounded-lg border border-gray-200 p-3">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm text-gray-600">Units {item.units} • Gross ${currencyAmount(item.gross)}</div>
                </div>
              )) : <div className="empty-state">No license mix yet.</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
