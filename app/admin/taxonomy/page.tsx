import { prisma } from '@/lib/prisma'
import { getActiveSite } from '@/lib/site'
import { requireAdminForSite } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function AdminTaxonomyPage() {
  const site = await getActiveSite()
  await requireAdminForSite(site.id)
  const [categories, groups, fieldTemplates, rules] = await Promise.all([
    prisma.category.findMany({ where: { siteId: site.id }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.categoryGroup.findMany({ where: { siteId: site.id }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.categoryFieldTemplate.findMany({ where: { category: { siteId: site.id } }, include: { category: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.categoryRule.findMany({ where: { category: { siteId: site.id } }, include: { category: true }, orderBy: [{ createdAt: 'asc' }] }),
  ])

  fieldTemplates.sort((a: any, b: any) => (a.category.name.localeCompare(b.category.name) || a.sortOrder - b.sortOrder))
  rules.sort((a: any, b: any) => (a.category.name.localeCompare(b.category.name) || a.key.localeCompare(b.key)))

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Taxonomy manager</h1>
        <p className="text-gray-600">Manage category groups, structured metadata fields, and category rules for {site.name}.</p>
      </div>

      <section className="space-y-4">
        <h2 className="section-title">Category groups</h2>
        <div className="card">
          <form action="/api/admin/category-groups" method="POST" className="card-body grid gap-4 md:grid-cols-4">
            <div><label className="label">Name</label><input className="input" name="name" required /></div>
            <div><label className="label">Slug</label><input className="input" name="slug" required pattern="[a-z0-9-]+" /></div>
            <div><label className="label">Sort order</label><input className="input" type="number" name="sortOrder" defaultValue={0} min={0} /></div>
            <div className="flex items-end"><button className="btn w-full" type="submit">Create group</button></div>
          </form>
        </div>
        {groups.length ? groups.map((group: any) => (
          <div key={group.id} className="card">
            <form action={`/api/admin/category-groups/${group.id}`} method="POST" className="card-body grid gap-4 md:grid-cols-5">
              <div><label className="label">Name</label><input className="input" name="name" defaultValue={group.name} required /></div>
              <div><label className="label">Slug</label><input className="input" name="slug" defaultValue={group.slug} required pattern="[a-z0-9-]+" /></div>
              <div><label className="label">Sort order</label><input className="input" type="number" name="sortOrder" defaultValue={group.sortOrder} min={0} /></div>
              <div className="flex items-end"><button className="btn w-full" type="submit">Save</button></div>
              <div className="flex items-end"><button className="btn-secondary w-full" type="submit" name="_action" value="delete">Delete</button></div>
            </form>
          </div>
        )) : <div className="empty-state">No category groups yet.</div>}
      </section>

      <section className="space-y-4">
        <h2 className="section-title">Category field templates</h2>
        <div className="card">
          <form action="/api/admin/category-field-templates" method="POST" className="card-body space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="label">Category</label>
                <select className="input" name="categoryId" required>
                  <option value="">Select category</option>
                  {categories.map((category: any) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </div>
              <div><label className="label">Field key</label><input className="input" name="name" placeholder="software" required /></div>
              <div><label className="label">Label</label><input className="input" name="label" placeholder="Software" required /></div>
              <div><label className="label">Field type</label><input className="input" name="fieldType" placeholder="text, select, textarea" required /></div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div><label className="label">Sort order</label><input className="input" type="number" name="sortOrder" defaultValue={0} min={0} /></div>
              <div className="flex items-end"><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="required" /> Required</label></div>
              <div><label className="label">Options JSON</label><input className="input" name="options" placeholder='["Figma","PSD"]' /></div>
            </div>
            <button className="btn" type="submit">Create field template</button>
          </form>
        </div>
        {fieldTemplates.length ? fieldTemplates.map((template: any) => (
          <div key={template.id} className="card">
            <form action={`/api/admin/category-field-templates/${template.id}`} method="POST" className="card-body space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <label className="label">Category</label>
                  <select className="input" name="categoryId" defaultValue={template.categoryId} required>
                    {categories.map((category: any) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Field key</label><input className="input" name="name" defaultValue={template.name} required /></div>
                <div><label className="label">Label</label><input className="input" name="label" defaultValue={template.label} required /></div>
                <div><label className="label">Field type</label><input className="input" name="fieldType" defaultValue={template.fieldType} required /></div>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <div><label className="label">Sort order</label><input className="input" type="number" name="sortOrder" defaultValue={template.sortOrder} min={0} /></div>
                <div className="flex items-end"><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="required" defaultChecked={template.required} /> Required</label></div>
                <div className="md:col-span-2"><label className="label">Options JSON</label><input className="input" name="options" defaultValue={template.options ? JSON.stringify(template.options) : ''} /></div>
              </div>
              <div className="flex gap-3"><button className="btn" type="submit">Save</button><button className="btn-secondary" type="submit" name="_action" value="delete">Delete</button></div>
            </form>
          </div>
        )) : <div className="empty-state">No field templates yet.</div>}
      </section>

      <section className="space-y-4">
        <h2 className="section-title">Category rules</h2>
        <div className="card">
          <form action="/api/admin/category-rules" method="POST" className="card-body space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="label">Category</label>
                <select className="input" name="categoryId" required>
                  <option value="">Select category</option>
                  {categories.map((category: any) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </div>
              <div><label className="label">Rule key</label><input className="input" name="key" placeholder="minPreviewCount" required /></div>
              <div><label className="label">Value JSON</label><input className="input" name="value" placeholder='{"count":1}' /></div>
            </div>
            <button className="btn" type="submit">Save rule</button>
          </form>
        </div>
        {rules.length ? rules.map((rule: any) => (
          <div key={rule.id} className="card">
            <form action={`/api/admin/category-rules/${rule.id}`} method="POST" className="card-body space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="label">Category</label>
                  <select className="input" name="categoryId" defaultValue={rule.categoryId} required>
                    {categories.map((category: any) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Rule key</label><input className="input" name="key" defaultValue={rule.key} required /></div>
                <div><label className="label">Value JSON</label><input className="input" name="value" defaultValue={rule.value ? JSON.stringify(rule.value) : ''} /></div>
              </div>
              <div className="flex gap-3"><button className="btn" type="submit">Save</button><button className="btn-secondary" type="submit" name="_action" value="delete">Delete</button></div>
            </form>
          </div>
        )) : <div className="empty-state">No category rules yet.</div>}
      </section>
    </div>
  )
}
