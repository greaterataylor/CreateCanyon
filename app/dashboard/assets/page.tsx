import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function MyAssetsPage() {
  const user = await currentUser()
  if (!user?.vendor) return <div className="empty-state">Create or apply for a seller profile first.</div>
  const site = await getActiveSite()
  const membership = user.vendor.memberships.find((item: any) => item.siteId === site.id)
  if (!membership) return <div className="empty-state">You do not have a seller membership for this marketplace yet.</div>
  const assets = await prisma.asset.findMany({ where: { siteId: site.id, vendorId: user.vendor.id }, include: { category: true, licenseOptions: { orderBy: { sortOrder: 'asc' } }, versions: { where: { isCurrent: true }, take: 1 } }, orderBy: { createdAt: 'desc' } })
  return (
    <div className="space-y-4"><h1 className="text-2xl font-bold">My assets</h1><DashboardNav />{assets.length ? <table className="table"><thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Price</th><th>Licenses</th><th>Version</th><th>Created</th><th></th></tr></thead><tbody>{assets.map((asset: any) => <tr key={asset.id}><td><a href={`/assets/${asset.id}`} className="font-medium text-brand-700">{asset.title}</a>{asset.rejectionReason && <div className="text-xs text-red-600">{asset.rejectionReason}</div>}</td><td>{asset.category.name}</td><td>{asset.status}</td><td>${currencyAmount(asset.priceCents)}</td><td>{asset.licenseOptions.map((option: any) => option.name).join(', ') || 'Standard'}</td><td>{asset.versions[0]?.versionLabel || '1.0.0'}</td><td>{asset.createdAt.toDateString()}</td><td><a className="btn-secondary" href={`/dashboard/assets/${asset.id}`}>Manage</a></td></tr>)}</tbody></table> : <div className="empty-state">You have not uploaded any assets for this marketplace yet.</div>}</div>
  )
}
