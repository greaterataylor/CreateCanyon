import DashboardNav from '@/components/DashboardNav'
import { currentUser } from '@/lib/auth'
import { getVendorLedgerSummary } from '@/lib/ledger'
import { prisma } from '@/lib/prisma'
import { getActiveSite, storefrontPath } from '@/lib/site'
import { currencyAmount } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(param: string | string[] | undefined) {
  return Array.isArray(param) ? param[0] : param
}

export default async function StorePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await currentUser()
  if (!user) return <div className="empty-state">Please sign in.</div>

  const params = await searchParams
  const site = await getActiveSite()
  const membership = user.vendor?.memberships.find((item: any) => item.siteId === site.id) || null
  const connectState = first(params.connect)
  const ledger = user.vendor ? await getVendorLedgerSummary(user.vendor.id, site.id) : null
  const [assetCount, paidSalesCount, downloadCount] = user.vendor
    ? await Promise.all([
        prisma.asset.count({ where: { siteId: site.id, vendorId: user.vendor.id } }),
        prisma.orderItem.count({ where: { asset: { siteId: site.id, vendorId: user.vendor.id }, order: { status: 'paid' } } }),
        prisma.downloadEvent.count({ where: { asset: { siteId: site.id, vendorId: user.vendor.id } } }),
      ])
    : [0, 0, 0]

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-2xl font-bold">Store profile</h1>
      <DashboardNav />

      {connectState && <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">Connect status: {connectState.replace(/-/g, ' ')}</div>}

      {!user.vendor ? (
        <div className="card"><div className="card-body space-y-3"><p>Create a vendor profile first.</p><form action="/api/vendor/apply" method="POST"><button className="btn">Create vendor profile</button></form></div></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
          <div className="space-y-4">
            <div className="card">
              <form action="/api/vendor/settings" method="POST" className="card-body space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><label className="label">Display name</label><input className="input" name="displayName" defaultValue={user.vendor.displayName} required /></div>
                  <div><label className="label">Storefront slug</label><input className="input" name="storefrontSlug" defaultValue={membership?.storefrontSlug || user.vendor.slug} required pattern="[a-z0-9-]+" /></div>
                </div>
                <div><label className="label">Bio</label><textarea className="input min-h-28" name="bio" defaultValue={user.vendor.bio || ''} /></div>
                <div><label className="label">Storefront name</label><input className="input" name="storefrontName" defaultValue={membership?.storefrontName || user.vendor.displayName} /></div>
                <div><label className="label">Headline</label><input className="input" name="headline" defaultValue={membership?.headline || ''} /></div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><label className="label">Payout email</label><input className="input" name="payoutEmail" type="email" defaultValue={membership?.payoutEmail || user.email} /></div>
                  <div><label className="label">Legal name</label><input className="input" name="legalName" defaultValue={membership?.legalName || ''} /></div>
                  <div><label className="label">Tax country</label><input className="input" name="taxCountry" defaultValue={membership?.taxCountry || ''} placeholder="US" /></div>
                </div>
                <div className="flex items-center gap-3">
                  <button className="btn" type="submit">Save store settings</button>
                  {membership?.storefrontSlug && <a href={storefrontPath(membership.storefrontSlug)} className="btn-secondary">View storefront</a>}
                </div>
                {membership?.moderationNotes && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Admin notes: {membership.moderationNotes}</div>}
              </form>
            </div>

            <div className="card">
              <div className="card-body space-y-3">
                <h2 className="font-semibold">Recent payout & ledger activity</h2>
                {ledger?.entries?.length ? ledger.entries.slice(0, 12).map((entry: any) => (
                  <div key={entry.id} className="rounded-lg border border-gray-200 p-3 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <div className="font-medium">{String(entry.type || '').replace(/_/g, ' ')}</div>
                      <div className="text-gray-500">{entry.notes || 'Ledger entry'} • {new Date(entry.createdAt).toDateString()}</div>
                    </div>
                    <div className={Number(entry.amountCents || 0) >= 0 ? 'font-semibold text-green-700' : 'font-semibold text-gray-700'}>${currencyAmount(Math.abs(Number(entry.amountCents || 0)))}</div>
                  </div>
                )) : <div className="empty-state">No ledger entries yet.</div>}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card"><div className="card-body space-y-3"><h2 className="font-semibold">Seller status</h2><div className="badge">{membership?.status || 'No membership'}</div><p className="text-sm text-gray-600">Per-site seller approvals let the same vendor account participate in some marketplaces and not others.</p>{!membership && <form action="/api/vendor/apply" method="POST"><button className="btn w-full" type="submit">Apply to sell on {site.name}</button></form>}</div></div>
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-1">
              <div className="kv-item"><div className="text-sm text-gray-500">Assets on this site</div><div className="mt-2 text-3xl font-bold">{assetCount}</div></div>
              <div className="kv-item"><div className="text-sm text-gray-500">Paid sales</div><div className="mt-2 text-3xl font-bold">{paidSalesCount}</div></div>
              <div className="kv-item"><div className="text-sm text-gray-500">Downloads</div><div className="mt-2 text-3xl font-bold">{downloadCount}</div></div>
            </div>
            <div className="card"><div className="card-body space-y-3"><h2 className="font-semibold">Stripe Connect</h2><p className="text-sm text-gray-600">Use Express onboarding to connect payout details for this marketplace.</p><div className="text-sm text-gray-500">Connected account: {membership?.stripeAccountId || 'Not connected'}</div>{membership?.stripeAccountStatus && <div className="text-sm text-gray-500">Account status: {membership.stripeAccountStatus}</div>}<div className="grid gap-2 text-sm text-gray-500"><div>Charges enabled: {membership?.stripeChargesEnabled ? 'Yes' : 'No'}</div><div>Payouts enabled: {membership?.stripePayoutsEnabled ? 'Yes' : 'No'}</div><div>Details submitted: {membership?.stripeDetailsSubmitted ? 'Yes' : 'No'}</div></div><div className="flex flex-col gap-3">{membership && <form action="/api/vendor/connect" method="POST"><input type="hidden" name="action" value="onboard" /><button className="btn w-full" type="submit">{membership.stripeAccountId ? 'Continue onboarding' : 'Start onboarding'}</button></form>}{membership?.stripeAccountId && <form action="/api/vendor/connect" method="POST"><input type="hidden" name="action" value="dashboard" /><button className="btn-secondary w-full" type="submit">Open Stripe dashboard</button></form>}</div></div></div>
            <div className="card"><div className="card-body space-y-2"><h2 className="font-semibold">Ledger snapshot</h2><div className="text-sm text-gray-500">Estimated balance</div><div className="text-3xl font-bold">${currencyAmount(ledger?.ledgerBalanceCents || 0)}</div><div className="text-sm text-gray-500">Gross sales: ${currencyAmount(ledger?.grossCents || 0)}</div></div></div>
          </div>
        </div>
      )}
    </div>
  )
}
