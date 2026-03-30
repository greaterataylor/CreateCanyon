import { getActiveSite } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import AdminSupportCases from '@/components/AdminSupportCases'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AdminDisputesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const site = await getActiveSite()
  await requireAdminForSite(site.id)
  return (
    <AdminSupportCases
      siteId={site.id}
      type="dispute"
      title="Disputes"
      redirectTo="/admin/disputes"
      flashState={first(params.caseUpdate) || null}
      flashCaseId={first(params.caseId) || null}
      flashMessageText={first(params.caseMessage) || null}
    />
  )
}
