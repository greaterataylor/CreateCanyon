import { currentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export default async function SalesPage() {
  const user = await currentUser()
  if (!user || !user.vendorProfile) return <div>Please sign in</div>

  const sales = await prisma.orderItem.findMany({
    where: { asset: { vendorId: user.vendorProfile.id }, order: { status: 'paid' } },
    include: { asset: true, order: true }
  })
  const total = sales.reduce((sum, s) => sum + s.priceCents * s.quantity, 0)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Sales & earnings</h1>
      <div className="card"><div className="card-body">
        <div className="text-sm">Gross sales</div>
        <div className="text-2xl font-bold">${(total/100).toFixed(2)}</div>
      </div></div>
      <table className="table">
        <thead><tr><th>Asset</th><th>Price</th><th>Qty</th><th>Date</th></tr></thead>
        <tbody>
          {sales.map(s => (
            <tr key={s.id}><td>{s.asset.title}</td><td>${(s.priceCents/100).toFixed(2)}</td><td>{s.quantity}</td><td>{s.order.createdAt.toDateString()}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
