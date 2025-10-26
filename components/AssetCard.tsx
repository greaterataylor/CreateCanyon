import Link from 'next/link'
import { Asset, PreviewType } from '@prisma/client'

export default function AssetCard({ asset }: { asset: Asset }) {
  return (
    <Link href={`/assets/${asset.id}`} className="card block overflow-hidden">
      <div className="card-body">
        <div className="text-sm text-gray-500 mb-1">{asset.previewType}</div>
        <h3 className="font-semibold text-lg">{asset.title}</h3>
        <p className="text-sm line-clamp-2 text-gray-600">{asset.description}</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-semibold">${(asset.priceCents/100).toFixed(2)}</span>
          <span className="badge">{asset.currency}</span>
        </div>
      </div>
    </Link>
  )
}
