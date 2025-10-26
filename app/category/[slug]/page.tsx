import { prisma } from '@/lib/prisma'
import AssetCard from '@/components/AssetCard'

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const cat = await prisma.category.findUnique({ where: { slug: params.slug } })
  if (!cat) return <div>Category not found</div>
  const assets = await prisma.asset.findMany({ where: { categoryId: cat.id, status: 'APPROVED' }, orderBy: { createdAt: 'desc' } })
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Category: {cat.name}</h1>
      <ul className="grid">
        {assets.map(a => <li key={a.id}><AssetCard asset={a} /></li>)}
      </ul>
    </div>
  )
}
