import { getActiveSite } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'
import { getLicenseTemplates } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export default async function AdminLicensesPage() {
  const site = await getActiveSite()
  await requireAdminForSite(site.id)
  const templates = getLicenseTemplates(site.settings)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">License templates</h1>
        <p className="text-gray-600">Create reusable license/EULA presets for uploads on {site.name}. These are stored in site settings so theme updates will not overwrite them.</p>
      </div>
      <section className="card">
        <form action="/api/admin/licenses" method="POST" className="card-body space-y-4">
          <h2 className="font-semibold">Create license template</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div><label className="label">Template key</label><input className="input" name="key" pattern="[a-z0-9-]+" required /></div>
            <div><label className="label">Template name</label><input className="input" name="name" required /></div>
            <div><label className="label">Extended price multiplier</label><input className="input" type="number" step="0.1" min="1" name="extendedMultiplier" defaultValue={2} /></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="label">Standard label</label><input className="input" name="standardLabel" defaultValue="Standard" required /></div>
            <div><label className="label">Extended label</label><input className="input" name="extendedLabel" defaultValue="Extended" required /></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="label">Standard license text</label><textarea className="input min-h-40" name="standardText" required /></div>
            <div><label className="label">Extended license text</label><textarea className="input min-h-40" name="extendedText" required /></div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" /> Set as default template</label>
          <div><button className="btn" type="submit">Create template</button></div>
        </form>
      </section>
      <section className="space-y-4">
        <h2 className="font-semibold">Existing templates</h2>
        {templates.map((template) => (
          <div key={template.key} className="card">
            <form action={`/api/admin/licenses/${template.key}`} method="POST" className="card-body space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div><label className="label">Template key</label><input className="input" value={template.key} readOnly /></div>
                <div><label className="label">Template name</label><input className="input" name="name" defaultValue={template.name} required /></div>
                <div><label className="label">Extended price multiplier</label><input className="input" type="number" step="0.1" min="1" name="extendedMultiplier" defaultValue={template.extendedMultiplier} /></div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div><label className="label">Standard label</label><input className="input" name="standardLabel" defaultValue={template.standardLabel} required /></div>
                <div><label className="label">Extended label</label><input className="input" name="extendedLabel" defaultValue={template.extendedLabel} required /></div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div><label className="label">Standard license text</label><textarea className="input min-h-40" name="standardText" defaultValue={template.standardText} required /></div>
                <div><label className="label">Extended license text</label><textarea className="input min-h-40" name="extendedText" defaultValue={template.extendedText} required /></div>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" defaultChecked={template.isDefault} /> Default template</label>
                <button className="btn" type="submit">Save</button>
                <button className="btn-secondary" type="submit" name="_action" value="delete">Delete</button>
              </div>
            </form>
          </div>
        ))}
      </section>
    </div>
  )
}
