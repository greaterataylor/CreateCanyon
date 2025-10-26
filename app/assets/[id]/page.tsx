import { prisma } from '@/lib/prisma'
import { ImageViewer, AudioPlayer, VideoPlayer, CodePreview } from '@/components/Players'
import { currentUser } from '@/lib/auth'
import Link from 'next/link'

export default async function AssetDetail({ params }: { params: { id: string } }) {
  const asset = await prisma.asset.findUnique({ where: { id: params.id }, include: { vendor: { include: { user: true } }, category: true, site: true } })
  if (!asset || asset.status !== 'APPROVED') return <div>Asset not found</div>
  const user = await currentUser()
  const purchased = user ? await prisma.purchase.findFirst({ where: { userId: user.id, assetId: asset.id } }) : null

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-4">
        <h1 className="text-2xl font-bold">{asset.title}</h1>
        <p className="text-gray-600">{asset.description}</p>
        <div>
          {asset.previewType === 'IMAGE' && asset.previewUrl && <ImageViewer src={asset.previewUrl} />}
          {asset.previewType === 'AUDIO' && asset.previewUrl && <AudioPlayer src={asset.previewUrl} />}
          {asset.previewType === 'VIDEO' && asset.previewUrl && <VideoPlayer src={asset.previewUrl} />}
          {asset.previewType === 'CODE' && <CodePreview code={'// code preview supplied by vendor\n'} />}
          {asset.previewType === 'FILE' && <div className="text-sm text-gray-500">No inline preview. See details.</div>}
        </div>
      </div>
      <aside className="space-y-4">
        <div className="card">
          <div className="card-body space-y-3">
            <div className="text-3xl font-bold">${(asset.priceCents/100).toFixed(2)} <span className="text-sm font-medium">{asset.currency}</span></div>
            {purchased ? (
              <form action={`/api/download/${asset.id}`} method="POST">
                <button className="btn w-full" type="submit">Download</button>
              </form>
            ) : (
              <form action="/api/checkout" method="POST">
                <input type="hidden" name="assetId" value={asset.id} />
                <button className="btn w-full" type="submit">Buy now</button>
              </form>
            )}
            <div className="text-xs text-gray-500">Sold by {asset.vendor.displayName} • Category: {asset.category.name}</div>
          </div>
        </div>
        <div className="card"><div className="card-body">
          <h3 className="font-semibold mb-1">License</h3>
          <p className="text-sm text-gray-600">Single-user commercial license. No reselling or redistribution.</p>
        </div></div>
      </aside>
    </div>
  )
}
