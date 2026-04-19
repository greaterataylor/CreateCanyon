import { currentUser } from '@/lib/auth'
import { getActiveSite } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function AdminHome() {
  const site = await getActiveSite()
  const admin = await requireAdminForSite(site.id)
  const cards = [
    { href: '/admin/site', title: 'Site settings', body: 'SEO, domain, theme JSON, settings JSON, and navigation items.' },
    { href: '/admin/categories', title: 'Categories', body: 'CRUD, parent/child, sort order, category metadata.' },
    { href: '/admin/taxonomy', title: 'Taxonomy manager', body: 'Category groups, field templates, and category rules.' },
    { href: '/admin/licenses', title: 'License templates', body: 'Reusable EULA presets stored outside the theme files.' },
    { href: '/admin/vendors', title: 'Vendors', body: 'Approve sellers per marketplace, store moderation notes, and run bulk actions.' },
    { href: '/admin/assets', title: 'Assets', body: 'Moderation queue with approval, rejection reasons, and bulk actions.' },
    { href: '/admin/refunds', title: 'Refunds', body: 'Review refund requests submitted by buyers.' },
    { href: '/admin/disputes', title: 'Disputes', body: 'Track and review payment or license disputes.' },
    { href: '/admin/takedowns', title: 'Takedowns', body: 'Review takedown and IP complaint requests.' },
    { href: '/admin/reports', title: 'Reports', body: 'Marketplace KPIs, tax, suspicious activity, and payout breakdowns.' },
    { href: '/admin/audit', title: 'Audit logs', body: 'Review moderation activity and suspicious events for this marketplace.' },
    { href: '/admin/jobs', title: 'Jobs', body: 'Background queue for scans, previews, metadata extraction, and transcoding.' },
  ]

  if (admin.role === 'SUPER_ADMIN') {
    cards.unshift({ href: '/admin/network', title: 'Network admin', body: 'Cross-site visibility for all marketplaces in the ZenBinary network.' })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-gray-600">Site-scoped admin tools for {site.name}. Super admins can also access network-wide reporting and oversight.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <a key={card.href} className="card hover:shadow-md" href={card.href}>
            <div className="card-body">
              <h3 className="font-semibold">{card.title}</h3>
              <p className="text-sm text-gray-600">{card.body}</p>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
