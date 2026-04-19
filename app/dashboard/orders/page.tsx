import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { orderDisplayNumber, receiptDisplayNumber } from '@/lib/orders'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  const user = await currentUser()
  if (!user) return <div className="empty-state">Please sign in.</div>
  const site = await getActiveSite()
  const orders = await prisma.order.findMany({ where: { userId: user.id, siteId: site.id }, include: { items: { include: { asset: true, licenseOption: true } } }, orderBy: { createdAt: 'desc' } })

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Order history</h1>
      <DashboardNav />
      {orders.length ? (
        <div className="space-y-4">
          {orders.map((order: any) => {
            const totalWithTax = Number(order.totalCents || 0) + Number(order.taxCents || 0)
            return (
              <div key={order.id} className="card">
                <div className="card-body space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{orderDisplayNumber(order)}</div>
                      <div className="text-sm text-gray-500">{order.createdAt.toDateString()} • {order.status} • {receiptDisplayNumber(order)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">Total</div>
                      <div className="text-xl font-bold">${currencyAmount(totalWithTax)}</div>
                    </div>
                  </div>
                  <table className="table">
                    <thead><tr><th>Asset</th><th>License</th><th>Unit price</th><th>Qty</th></tr></thead>
                    <tbody>{order.items.map((item: any) => <tr key={item.id}><td>{item.asset.title}</td><td>{item.licenseOption?.name || 'Standard'}</td><td>${currencyAmount(item.priceCents)}</td><td>{item.quantity}</td></tr>)}</tbody>
                  </table>
                  <div className="flex flex-wrap gap-3"><a className="btn-secondary" href={`/dashboard/orders/${order.id}`}>Open receipt</a></div>
                </div>
              </div>
            )
          })}
        </div>
      ) : <div className="empty-state">No orders yet.</div>}
    </div>
  )
}
