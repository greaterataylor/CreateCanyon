import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { receiptDisplayNumber } from '@/lib/orders'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function ReceiptsPage() {
  const user = await currentUser()
  if (!user) return <div className="empty-state">Please sign in.</div>
  const site = await getActiveSite()
  const orders = await prisma.order.findMany({
    where: { userId: user.id, siteId: site.id, status: { in: ['paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost'] } },
    include: { items: { include: { asset: true, licenseOption: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Receipts & invoices</h1>
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
                      <div className="font-semibold">{receiptDisplayNumber(order)}</div>
                      <div className="text-sm text-gray-500">{order.createdAt.toDateString()} • {order.status}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">Total</div>
                      <div className="text-xl font-bold">${currencyAmount(totalWithTax)}</div>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm text-gray-600">
                    {order.items.map((item: any) => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
                        <div>
                          <div className="font-medium">{item.asset.title}</div>
                          <div>{item.licenseOption?.name || 'Standard'} license</div>
                        </div>
                        <div>${currencyAmount(item.priceCents)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <a href={`/dashboard/orders/${order.id}`} className="btn-secondary">Open receipt</a>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="empty-state">No paid receipts yet.</div>
      )}
    </div>
  )
}
