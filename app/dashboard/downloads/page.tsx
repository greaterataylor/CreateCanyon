import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(param: string | string[] | undefined) {
  return Array.isArray(param) ? param[0] : param
}

export default async function DownloadsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await currentUser()
  if (!user) return <div className="empty-state">Please sign in.</div>
  const site = await getActiveSite()
  const query = await searchParams
  const downloadState = first(query.download)
  const purchases = await prisma.purchase.findMany({ where: { userId: user.id, siteId: site.id }, include: { asset: true, downloadEvents: { orderBy: { createdAt: 'desc' }, take: 5 } }, orderBy: [{ lastDownloadedAt: 'desc' }, { createdAt: 'desc' }] })
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Download library</h1>
      <DashboardNav />
      {(downloadState === 'disabled' || downloadState === 'frozen') && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Downloads are temporarily frozen for that asset while it is under review.</div>}
      {downloadState === 'rate-limited' && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Download temporarily blocked due to burst activity. Please wait before trying again.</div>}
      {downloadState === 'missing-file' && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">The latest download file could not be found for that purchase.</div>}
      {purchases.length ? <div className="grid gap-4">{purchases.map((purchase: any) => <div key={purchase.id} className="card"><div className="card-body flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><div className="font-semibold">{purchase.asset.title}</div><div className="text-sm text-gray-500">Downloads: {purchase.downloadCount} • Last downloaded: {purchase.lastDownloadedAt ? purchase.lastDownloadedAt.toDateString() : 'Never'}</div>{purchase.downloadEvents.length > 0 && <div className="mt-2 text-xs text-gray-500">Recent activity: {purchase.downloadEvents.map((event: any) => event.createdAt.toDateString()).join(', ')}</div>}{purchase.asset.downloadsDisabled && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">Downloads are currently frozen for this asset.</div>}</div>{purchase.asset.downloadsDisabled ? <span className="badge">Frozen</span> : <form action={`/api/download/${purchase.asset.id}`} method="POST"><button className="btn" type="submit">Download</button></form>}</div></div>)}</div> : <div className="empty-state">Your download library is empty.</div>}
    </div>
  )
}
