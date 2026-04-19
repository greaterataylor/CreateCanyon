import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSite, storefrontPath } from '@/lib/site'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const user = await currentUser()
  if (!user) return <div className="max-w-md mx-auto card"><div className="card-body space-y-3"><h1 className="text-xl font-semibold">Please sign in</h1><a className="btn mt-2" href="/sign-in">Sign in</a></div></div>
  const site = await getActiveSite()
  const membership = user.vendor?.memberships.find((item: any) => item.siteId === site.id) || null
  const [purchaseCount, orderCount, vendorAssets, grossSales] = await Promise.all([
    prisma.purchase.count({ where: { userId: user.id, siteId: site.id } }),
    prisma.order.count({ where: { userId: user.id, siteId: site.id } }),
    membership ? prisma.asset.count({ where: { siteId: site.id, vendorId: user.vendor!.id } }) : Promise.resolve(0),
    membership ? prisma.orderItem.aggregate({ where: { asset: { siteId: site.id, vendorId: user.vendor!.id }, order: { status: 'paid' } }, _sum: { priceCents: true } }) : Promise.resolve({ _sum: { priceCents: 0 } }),
  ])
  return (
    <div className="space-y-6">
      <div className="space-y-2"><h1 className="text-2xl font-bold">Dashboard</h1><p className="text-gray-600">Buyer account tools and site-specific seller management for {site.name}.</p></div>
      <DashboardNav />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div className="kv-item"><div className="text-sm text-gray-500">Purchases</div><div className="mt-2 text-3xl font-bold">{purchaseCount}</div></div><div className="kv-item"><div className="text-sm text-gray-500">Orders</div><div className="mt-2 text-3xl font-bold">{orderCount}</div></div><div className="kv-item"><div className="text-sm text-gray-500">My assets on this site</div><div className="mt-2 text-3xl font-bold">{vendorAssets}</div></div><div className="kv-item"><div className="text-sm text-gray-500">Gross seller revenue</div><div className="mt-2 text-3xl font-bold">${currencyAmount(grossSales._sum.priceCents || 0)}</div></div></section>
      <section className="space-y-3"><h2 className="section-title">Seller status on {site.name}</h2>{!membership ? <div className="card"><div className="card-body space-y-3"><p className="text-gray-600">You do not have a seller membership for this marketplace yet.</p><form action="/api/vendor/apply" method="POST"><button className="btn" type="submit">Apply to sell on {site.name}</button></form></div></div> : <div className="card"><div className="card-body space-y-2"><div className="font-semibold">Status: {membership.status}</div><div className="text-sm text-gray-600">Storefront: {membership.storefrontName || membership.storefrontSlug}</div>{membership.headline && <div className="text-sm text-gray-600">{membership.headline}</div>}{membership.moderationNotes && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Admin notes: {membership.moderationNotes}</div>}<div className="flex flex-wrap gap-2"><a href="/dashboard/store" className="btn-secondary">Manage storefront</a>{membership.status === 'APPROVED' && <><a href="/dashboard/upload" className="btn">Upload asset</a><a href={storefrontPath(membership.storefrontSlug)} className="btn-secondary">View storefront</a></>}</div></div></div>}</section>
    </div>
  )
}
