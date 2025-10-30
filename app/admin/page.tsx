//app/admin/page.tsx
import { requireAdmin } from '@/lib/auth'

export default async function AdminHome() {
  await requireAdmin()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Admin</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a className="card" href="/admin/categories"><div className="card-body"><h3 className="font-semibold">Categories</h3></div></a>
        <a className="card" href="/admin/vendors"><div className="card-body"><h3 className="font-semibold">Vendors</h3></div></a>
        <a className="card" href="/admin/assets"><div className="card-body"><h3 className="font-semibold">Assets</h3></div></a>
      </div>
    </div>
  )
}
