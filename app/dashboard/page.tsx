import { currentUser } from '@/lib/auth'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'

export default async function Dashboard() {
  const user = await currentUser()
  if (!user) return <div className="max-w-md mx-auto card"><div className="card-body"><h1 className="text-xl font-semibold">Please sign in</h1><a className="btn mt-2" href="/sign-in">Sign in</a></div></div>

  const vendor = user.vendorProfile
  const status = vendor?.status
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Dashboard</h1>
      {!vendor && (
        <form action="/api/vendor/apply" method="POST">
          <button className="btn">Become a vendor</button>
        </form>
      )}
      {vendor && status === 'PENDING' && <div className="card"><div className="card-body">Your vendor application is pending approval.</div></div>}
      {vendor && status === 'REJECTED' && <div className="card"><div className="card-body">Your vendor application was rejected.</div></div>}
      {vendor && status === 'APPROVED' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a className="card" href="/dashboard/upload"><div className="card-body"><h3 className="font-semibold">Upload new asset</h3></div></a>
          <a className="card" href="/dashboard/assets"><div className="card-body"><h3 className="font-semibold">Manage my assets</h3></div></a>
          <a className="card" href="/dashboard/sales"><div className="card-body"><h3 className="font-semibold">Sales & earnings</h3></div></a>
        </div>
      )}
    </div>
  )
}
