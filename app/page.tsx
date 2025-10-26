import { prisma } from '@/lib/prisma'
import AssetCard from '@/components/AssetCard'

export default async function Home() {
  const slug = process.env.SITE_SLUG || 'CreateCanyon'
  const site = await prisma.site.findUnique({ where: { slug } })
  if (!site) {
    return <div className="prose"><h1>Site not seeded</h1><p>Run <code>npm run db:seed</code> first.</p></div>
  }
  const categories = await prisma.category.findMany({ where: { siteId: site.id }, orderBy: { name: 'asc' } })
  const assets = await prisma.asset.findMany({ where: { siteId: site.id, status: 'APPROVED' }, orderBy: { createdAt: 'desc' }, take: 24 })
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">{site.name}</h1>
        <p className="text-gray-600">Explore the latest approved assets. Choose a category to narrow down.</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        {categories.map(c => (
          <a key={c.id} href={`/category/${c.slug}`} className="badge hover:bg-brand-100">{c.name}</a>
        ))}
      </div>
      <ul className="asset-grid">
        {assets.map(a => (
          <li key={a.id}><AssetCard asset={a} /></li>
        ))}
      </ul>
    </div>
  )
}
