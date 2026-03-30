import DashboardNav from '@/components/DashboardNav'
import SavedAssetsDashboard from '@/components/SavedAssetsDashboard'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(param: string | string[] | undefined) {
  return Array.isArray(param) ? param[0] : param
}

export default async function CollectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const checkoutState = first(params.checkout)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Collections</h1>
      <DashboardNav />
      {checkoutState === 'currency-mismatch' ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Selected assets must use the same currency for a single checkout session.</div> : null}
      {checkoutState === 'owned' ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Every selected license is already owned on this marketplace.</div> : null}
      {checkoutState === 'cancelled' ? <div className="rounded-lg bg-gray-100 p-3 text-sm text-gray-700">Checkout was cancelled before payment completion.</div> : null}
      <SavedAssetsDashboard />
    </div>
  )
}
