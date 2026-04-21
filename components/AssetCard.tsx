import Image from 'next/image'
import Link from 'next/link'
import { currencyAmount } from '@/lib/utils'

type AssetCardAsset = {
  id: string
  title: string
  description: string
  priceCents: number
  currency: string
  previewType: string
  previewUrl: string | null
  kind?: string | null
  vendor?: { displayName?: string | null } | null
  category?: { name: string } | null
}

export default function AssetCard({ asset }: { asset: AssetCardAsset }) {
  return (
    <Link href={`/assets/${asset.id}`} className="card block h-full overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative h-44 bg-gray-100">
        {asset.previewUrl && (asset.previewType === 'IMAGE' || asset.previewType === 'PDF') ? (
          <Image src={asset.previewUrl} alt={asset.title} fill className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">{asset.kind || asset.previewType}</div>
        )}
      </div>
      <div className="card-body flex h-[calc(100%-11rem)] flex-col gap-2">
        <div className="flex items-center justify-between gap-2"><span className="badge">{asset.kind || asset.previewType}</span><span className="text-xs uppercase tracking-wide text-gray-500">{asset.currency}</span></div>
        <h3 className="text-lg font-semibold leading-tight">{asset.title}</h3>
        <p className="line-clamp-3 text-sm text-gray-600">{asset.description}</p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <div><div className="font-semibold">${currencyAmount(asset.priceCents)}</div>{asset.vendor?.displayName && <div className="text-xs text-gray-500">by {asset.vendor.displayName}</div>}</div>
          {asset.category?.name && <span className="text-xs text-gray-500">{asset.category.name}</span>}
        </div>
      </div>
    </Link>
  )
}
