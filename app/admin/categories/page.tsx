//app/admin/categories/page.tsx
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

export default async function AdminCategories() {
  await requireAdmin()
  const slug = process.env.SITE_SLUG || 'CreateCanyon'
  const site = await prisma.site.findUnique({ where: { slug } })
  if (!site) return <div>Site not found</div>
  const categories = await prisma.category.findMany({ where: { siteId: site.id }, orderBy: { name: 'asc' } })
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Categories</h1>
      <form action="/api/admin/categories" method="POST" className="flex gap-2">
        <input className="input" name="name" placeholder="Name" required />
        <input className="input" name="slug" placeholder="slug-like-this" pattern="[a-z0-9-]+" required />
        <button className="btn" type="submit">Add</button>
      </form>
      <table className="table">
        <thead><tr><th>Name</th><th>Slug</th></tr></thead>
        <tbody>
          {categories.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.slug}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}
