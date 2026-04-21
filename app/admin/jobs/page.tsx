import { listProcessingJobs } from '@/lib/jobs'
import { requireAdminForSite } from '@/lib/permissions'
import { getActiveSite } from '@/lib/site'

export const dynamic = 'force-dynamic'

export default async function AdminJobsPage() {
  const site = await getActiveSite()
  await requireAdminForSite(site.id)
  const jobs = await listProcessingJobs(site.id, 100)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Processing jobs</h1>
        <p className="text-gray-600">Queued background jobs for previews, metadata extraction, scanning, and transcoding on {site.name}.</p>
      </div>
      {jobs.length ? (
        <table className="table">
          <thead><tr><th>Job</th><th>Asset</th><th>Status</th><th>Attempts</th><th>Created</th><th>Finished</th></tr></thead>
          <tbody>
            {jobs.map((job: any) => (
              <tr key={job.id}>
                <td>
                  <div className="font-medium">{job.jobType}</div>
                  <div className="text-xs text-gray-500">{job.id}</div>
                </td>
                <td>{job.asset?.title || job.assetId}</td>
                <td>{job.status}</td>
                <td>{job.attempts ?? 0}</td>
                <td>{job.createdAt ? new Date(job.createdAt).toDateString() : '—'}</td>
                <td>{job.finishedAt ? new Date(job.finishedAt).toDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="empty-state">No queued jobs yet.</div>}
    </div>
  )
}
