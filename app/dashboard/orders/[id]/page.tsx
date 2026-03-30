import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { orderDisplayNumber, receiptDisplayNumber } from '@/lib/orders'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>

export default async function OrderReceiptPage({ params }: { params: Params }) {
  const { id } = await params
  const user = await currentUser()
  if (!user) return <div className="empty-state">Please sign in.</div>
  const site = await getActiveSite()
  const order = await prisma.order.findFirst({
    where: { id, userId: user.id, siteId: site.id },
    include: {
      items: { include: { asset: { include: { vendor: true, vendorSiteMembership: true } }, licenseOption: true } },
      purchases: { include: { licenseOption: true, asset: true } },
    },
  })
  if (!order) return <div className="empty-state">Order not found on this marketplace.</div>

  const subtotalCents = Number(order.totalCents || 0)
  const taxCents = Number(order.taxCents || 0)
  const grossCents = subtotalCents + taxCents

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Receipt</h1>
        <p className="text-gray-600">Printable order receipt and license record for {site.name}.</p>
      </div>
      <DashboardNav />
      <section className="card">
        <div className="card-body space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-gray-500">Marketplace</div>
              <div className="text-xl font-semibold">{site.name}</div>
              <div className="text-sm text-gray-500">Buyer: {user.email}</div>
            </div>
            <div className="text-right text-sm text-gray-600">
              <div>Order: <span className="font-medium">{orderDisplayNumber(order)}</span></div>
              <div>Receipt: <span className="font-medium">{receiptDisplayNumber(order)}</span></div>
              <div>Date: {order.createdAt.toDateString()}</div>
              <div>Status: {order.status}</div>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr><th>Asset</th><th>Seller</th><th>License</th><th>Unit price</th><th>Qty</th><th>Line total</th></tr>
            </thead>
            <tbody>
              {order.items.map((item: any) => (
                <tr key={item.id}>
                  <td>{item.asset.title}</td>
                  <td>{item.asset.vendorSiteMembership?.storefrontName || item.asset.vendor.displayName}</td>
                  <td>{item.licenseOption?.name || 'Standard'}</td>
                  <td>${currencyAmount(item.priceCents)}</td>
                  <td>{item.quantity}</td>
                  <td>${currencyAmount(item.priceCents * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-gray-200 p-4">
              <div className="font-semibold">Totals</div>
              <div className="flex items-center justify-between text-sm"><span>Subtotal</span><span>${currencyAmount(subtotalCents)}</span></div>
              <div className="flex items-center justify-between text-sm"><span>Tax</span><span>${currencyAmount(taxCents)}</span></div>
              <div className="flex items-center justify-between font-semibold"><span>Total</span><span>${currencyAmount(grossCents)}</span></div>
            </div>
            <div className="space-y-2 rounded-lg border border-gray-200 p-4">
              <div className="font-semibold">License records</div>
              {order.purchases.length ? order.purchases.map((purchase: any) => (
                <div key={purchase.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                  <div className="font-medium">{purchase.asset.title}</div>
                  <div>{purchase.licenseOption?.name || 'Standard'} license</div>
                  <div className="text-xs text-gray-500 break-all">License key: {purchase.licenseKey}</div>
                </div>
              )) : <div className="text-sm text-gray-500">License records will appear after payment completion.</div>}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
