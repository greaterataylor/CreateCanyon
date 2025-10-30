// app/admin/vendors/page.tsx
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

export default async function AdminVendors() {
  await requireAdmin()
  const vendors = await prisma.vendorProfile.findMany({
    include: { user: true },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Vendors</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th><th>Email</th><th>Status</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {vendors.map(v => (
            <tr key={v.id}>
              <td>{v.displayName}</td>
              <td>{v.user.email}</td>
              <td>{v.status}</td>
              <td className="flex gap-2">
                <form action={`/api/admin/vendors/${v.id}`} method="POST">
                  <input type="hidden" name="status" value="APPROVED" />
                  <button className="btn-secondary">Approve</button>
                </form>
                <form action={`/api/admin/vendors/${v.id}`} method="POST">
                  <input type="hidden" name="status" value="REJECTED" />
                  <button className="btn-secondary">Reject</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
