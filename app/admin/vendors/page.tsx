import { prisma } from '@/lib/prisma'
import { getActiveSite, storefrontPath } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function AdminVendors() {
  const site = await getActiveSite()
  await requireAdminForSite(site.id)
  const memberships = await prisma.vendorSiteMembership.findMany({ where: { siteId: site.id }, include: { vendor: { include: { user: true } } }, orderBy: { createdAt: 'desc' } })

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Vendors</h1>
        <p className="text-gray-600">Review seller applications, moderation notes, Stripe readiness, and run bulk approval actions.</p>
      </div>

      <form id="bulk-vendors-form" action="/api/admin/vendors/bulk" method="POST" className="card">
        <div className="card-body grid gap-4 md:grid-cols-[1.2fr,1fr,auto]">
          <div>
            <label className="label">Bulk status</label>
            <select className="input" name="status" defaultValue="APPROVED">
              <option>PENDING</option><option>APPROVED</option><option>REJECTED</option><option>SUSPENDED</option>
            </select>
          </div>
          <div>
            <label className="label">Bulk moderation notes</label>
            <input className="input" name="moderationNotes" placeholder="Optional review note" />
          </div>
          <div className="flex items-end">
            <button className="btn" type="submit">Apply to selected vendors</button>
          </div>
        </div>
      </form>

      {memberships.length ? (
        <div className="space-y-4">
          {memberships.map((membership: any) => (
            <div key={membership.id} className="card">
              <div className="card-body space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <input form="bulk-vendors-form" type="checkbox" name="membershipIds" value={membership.id} className="mt-1" />
                    <div>
                      <div className="text-lg font-semibold">{membership.storefrontName || membership.vendor.displayName}</div>
                      <div className="text-sm text-gray-500">{membership.vendor.user.email}</div>
                      <div className="text-sm text-gray-500">Vendor slug: {membership.vendor.slug}</div>
                      <div className="text-sm text-gray-500">Storefront slug: {membership.storefrontSlug}</div>
                    </div>
                  </div>
                  <div className="badge">{membership.status}</div>
                </div>
                <div className="grid gap-4 md:grid-cols-4 text-sm text-gray-600">
                  <div className="rounded-lg border border-gray-200 p-3">Payout email: {membership.payoutEmail || '—'}</div>
                  <div className="rounded-lg border border-gray-200 p-3">Stripe account: {membership.stripeAccountId || 'Not connected'}</div>
                  <div className="rounded-lg border border-gray-200 p-3">Charges enabled: {membership.stripeChargesEnabled ? 'Yes' : 'No'}</div>
                  <div className="rounded-lg border border-gray-200 p-3">Payouts enabled: {membership.stripePayoutsEnabled ? 'Yes' : 'No'}</div>
                </div>
                <form action={`/api/admin/vendors/${membership.id}`} method="POST" className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="label">Status</label>
                    <select className="input" name="status" defaultValue={membership.status}><option>PENDING</option><option>APPROVED</option><option>REJECTED</option><option>SUSPENDED</option></select>
                  </div>
                  <div>
                    <label className="label">Moderation notes</label>
                    <textarea className="input min-h-24" name="moderationNotes" defaultValue={membership.moderationNotes || ''} />
                  </div>
                  <div className="flex gap-3 md:col-span-2">
                    <button className="btn" type="submit">Save review</button>
                    <a className="btn-secondary" href={storefrontPath(membership.storefrontSlug)}>Open storefront</a>
                  </div>
                </form>
              </div>
            </div>
          ))}
        </div>
      ) : <div className="empty-state">No vendor applications for this marketplace yet.</div>}
    </div>
  )
}
