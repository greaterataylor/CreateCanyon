import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function AdminSitePage() {
  const site = await getActiveSite()
  await requireAdminForSite(site.id)
  const navigationItems = await prisma.siteNavigationItem.findMany({ where: { siteId: site.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Site settings</h1>
        <p className="text-gray-600">Branding, SEO, theme JSON, content JSON, and navigation for {site.name}.</p>
      </div>

      <div className="card">
        <form action="/api/admin/site" method="POST" className="card-body space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Site name</label>
              <input className="input" name="name" defaultValue={site.name} required />
            </div>
            <div>
              <label className="label">Primary domain</label>
              <input className="input" name="domain" defaultValue={site.domain || ''} placeholder="createcanyon.com" />
            </div>
          </div>

          <div>
            <label className="label">Logo URL</label>
            <input className="input" name="logoUrl" defaultValue={site.logoUrl || ''} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">SEO title</label>
              <input className="input" name="seoTitle" defaultValue={site.seoTitle || ''} />
            </div>
            <div>
              <label className="label">SEO description</label>
              <input className="input" name="seoDescription" defaultValue={site.seoDescription || ''} />
            </div>
          </div>

          <div>
            <label className="label">Theme JSON</label>
            <textarea className="input min-h-40 font-mono text-xs" name="theme" defaultValue={site.theme ? JSON.stringify(site.theme, null, 2) : '{\n  "brand": {\n    "500": "#5c6cff",\n    "700": "#333cc0"\n  },\n  "backgroundColor": "#f9fafb"\n}'} />
          </div>

          <div>
            <label className="label">Settings JSON</label>
            <textarea className="input min-h-56 font-mono text-xs" name="settings" defaultValue={site.settings ? JSON.stringify(site.settings, null, 2) : '{\n  "hero": {\n    "eyebrow": "Digital marketplace",\n    "heading": "Sell and buy digital goods"\n  },\n  "legalDocuments": [],\n  "emailTemplates": {}\n}'} />
            <div className="mt-2 text-xs text-gray-500">Use this JSON for homepage hero content, legal docs, commission rules, email templates, and other site-managed content blocks so theme deployments do not overwrite them.</div>
          </div>

          <button className="btn" type="submit">Save site settings</button>
        </form>
      </div>

      <div className="card">
        <div className="card-body space-y-4">
          <div>
            <h2 className="font-semibold">Navigation items</h2>
            <p className="text-sm text-gray-600">Manage the marketplace navigation from the database instead of hardcoding links in the app shell.</p>
          </div>

          <form action="/api/admin/navigation" method="POST" className="grid gap-4 rounded-xl border border-gray-200 p-4 md:grid-cols-4">
            <div>
              <label className="label">Label</label>
              <input className="input" name="label" placeholder="Explore" required />
            </div>
            <div>
              <label className="label">Href</label>
              <input className="input" name="href" placeholder="/" required />
            </div>
            <div>
              <label className="label">Sort order</label>
              <input className="input" type="number" min={0} name="sortOrder" defaultValue={navigationItems.length} />
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" name="isVisible" defaultChecked /> Visible</label>
              <button className="btn" type="submit">Add nav item</button>
            </div>
          </form>

          {navigationItems.length ? (
            <div className="space-y-3">
              {navigationItems.map((item: any) => (
                <form key={item.id} action={`/api/admin/navigation/${item.id}`} method="POST" className="grid gap-4 rounded-xl border border-gray-200 p-4 md:grid-cols-5">
                  <div>
                    <label className="label">Label</label>
                    <input className="input" name="label" defaultValue={item.label} required />
                  </div>
                  <div>
                    <label className="label">Href</label>
                    <input className="input" name="href" defaultValue={item.href} required />
                  </div>
                  <div>
                    <label className="label">Sort order</label>
                    <input className="input" type="number" min={0} name="sortOrder" defaultValue={item.sortOrder} />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" name="isVisible" defaultChecked={item.isVisible} /> Visible</label>
                  </div>
                  <div className="flex items-end gap-3">
                    <button className="btn" type="submit">Save</button>
                    <button className="btn-secondary" type="submit" name="_action" value="delete">Delete</button>
                  </div>
                </form>
              ))}
            </div>
          ) : <div className="empty-state">No custom navigation items yet. The site will fall back to the default nav links until you add some.</div>}
        </div>
      </div>
    </div>
  )
}
