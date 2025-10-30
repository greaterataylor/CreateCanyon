//app/admin/assets/page.tsx
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

export default async function AdminAssets() {
  await requireAdmin()
  const slug = process.env.SITE_SLUG || 'CreateCanyon'
  const site = await prisma.site.findUnique({ where: { slug } })
  const assets = await prisma.asset.findMany({ where: { siteId: site!.id }, include: { vendor: { include: { user: true } }, category: true }, orderBy: { createdAt: 'desc' } })
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Assets</h1>
      <table className="table">
        <thead><tr><th>Title</th><th>Vendor</th><th>Category</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {assets.map(a => (
            <tr key={a.id}>
              <td>{a.title}</td>
              <td>{a.vendor.displayName}</td>
              <td>{a.category.name}</td>
              <td>{a.status}</td>
              <td className="flex gap-2">
                <form action={`/api/admin/assets/${a.id}`} method="POST"><input type="hidden" name="status" value="APPROVED" /><button className="btn-secondary">Approve</button></form>
                <form action={`/api/admin/assets/${a.id}`} method="POST"><input type="hidden" name="status" value="REJECTED" /><button className="btn-secondary">Reject</button></form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
