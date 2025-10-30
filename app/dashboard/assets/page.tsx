//app/dashboard/assets/page.tsx
import { currentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export default async function MyAssetsPage() {
  const user = await currentUser()
  if (!user || !user.vendorProfile) return <div>Please sign in</div>
  const assets = await prisma.asset.findMany({ where: { vendorId: user.vendorProfile.id }, orderBy: { createdAt: 'desc' } })
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">My assets</h1>
      <table className="table">
        <thead><tr><th>Title</th><th>Status</th><th>Price</th><th>Created</th></tr></thead>
        <tbody>
          {assets.map(a => (
            <tr key={a.id}><td>{a.title}</td><td>{a.status}</td><td>${(a.priceCents/100).toFixed(2)}</td><td>{a.createdAt.toDateString()}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
