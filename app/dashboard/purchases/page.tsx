import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { receiptDisplayNumber } from '@/lib/orders'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(param: string | string[] | undefined) {
  return Array.isArray(param) ? param[0] : param
}

export default async function PurchasesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await currentUser()
  if (!user) return <div className="empty-state">Please sign in.</div>
  const site = await getActiveSite()
  const query = await searchParams
  const downloadState = first(query.download)
  const purchases = await prisma.purchase.findMany({ where: { userId: user.id, siteId: site.id }, include: { asset: { include: { vendor: true, vendorSiteMembership: true } }, order: true, licenseOption: true }, orderBy: { createdAt: 'desc' } })

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My purchases</h1>
      <DashboardNav />
      {(downloadState === 'disabled' || downloadState === 'frozen') && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Downloads are temporarily frozen for that asset while it is under review.</div>}
      {downloadState === 'rate-limited' && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Download temporarily blocked due to burst activity. Please wait before trying again.</div>}
      {downloadState === 'missing-file' && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">The latest download file could not be found for that purchase.</div>}
      {purchases.length ? (
        <table className="table">
          <thead><tr><th>Asset</th><th>Seller</th><th>License</th><th>License key</th><th>Receipt</th><th>Purchased</th><th></th></tr></thead>
          <tbody>
            {purchases.map((purchase: any) => (
              <tr key={purchase.id}>
                <td><a href={`/assets/${purchase.asset.id}`} className="font-medium text-brand-700">{purchase.asset.title}</a></td>
                <td>{purchase.asset.vendorSiteMembership?.storefrontName || purchase.asset.vendor.displayName}</td>
                <td>{purchase.licenseOption?.name || 'Standard'}</td>
                <td className="text-xs break-all">{purchase.licenseKey}</td>
                <td><a className="text-brand-700" href={`/dashboard/orders/${purchase.orderId}`}>{receiptDisplayNumber(purchase.order)}</a></td>
                <td>{purchase.createdAt.toDateString()}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    {purchase.asset.downloadsDisabled ? <span className="badge">Frozen</span> : <form action={`/api/download/${purchase.asset.id}`} method="POST"><button className="btn-secondary" type="submit">Download</button></form>}
                    <a className="btn-secondary" href={`/dashboard/orders/${purchase.orderId}`}>Receipt</a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="empty-state">You have not purchased any assets on this marketplace yet.</div>}
    </div>
  )
}
