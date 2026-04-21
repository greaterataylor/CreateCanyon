'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSavedAssetIds } from './SaveAssetButton'

type Asset = {
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

type Collection = {
  id: string
  name: string
  isDefault?: boolean
  items: Array<{ asset: Asset }>
}

export default function SavedAssetsDashboard() {
  const [mode, setMode] = useState<'server' | 'local'>('local')
  const [ids, setIds] = useState<string[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    const sync = async () => {
      setLoading(true)
      try {
        const collectionRes = await fetch('/api/collections', { cache: 'no-store' })
        if (collectionRes.ok) {
          const data = await collectionRes.json()
          const nextCollections = Array.isArray(data.collections) ? data.collections : []
          const initialIds = Array.from(new Set(nextCollections.flatMap((collection: Collection) => collection.items.map((item) => item.asset.id)))) as string[]
          setMode('server')
          setCollections(nextCollections)
          setAssets([])
          setIds([])
          setSelectedIds(initialIds)
          return
        }
      } catch {
      }

      const nextIds = getSavedAssetIds()
      setMode('local')
      setIds(nextIds)
      setSelectedIds(nextIds)
      if (!nextIds.length) {
        setAssets([])
        setCollections([])
        setLoading(false)
        return
      }
      try {
        const res = await fetch(`/api/assets/saved?ids=${encodeURIComponent(nextIds.join(','))}`, { cache: 'no-store' })
        const data = await res.json()
        setAssets(Array.isArray(data) ? data : [])
      } catch {
        setAssets([])
      } finally {
        setCollections([])
      }
    }

    void sync().finally(() => setLoading(false))
    const handler = () => { void sync() }
    window.addEventListener('saved-assets-updated', handler as EventListener)
    return () => window.removeEventListener('saved-assets-updated', handler as EventListener)
  }, [])

  const missingCount = useMemo(() => Math.max(ids.length - assets.length, 0), [ids.length, assets.length])
  const allVisibleAssets = useMemo(() => {
    if (mode === 'server') return Array.from(new Set(collections.flatMap((collection) => collection.items.map((item) => item.asset.id))))
    return assets.map((asset) => asset.id)
  }, [assets, collections, mode])

  const toggleSelected = (assetId: string) => {
    setSelectedIds((current) => current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId])
  }

  const toggleAll = () => {
    setSelectedIds((current) => current.length === allVisibleAssets.length ? [] : allVisibleAssets)
  }

  const removeLocal = (assetId: string) => {
    const next = ids.filter((id) => id !== assetId)
    window.localStorage.setItem('znb-saved-assets', JSON.stringify(next))
    setSelectedIds((current) => current.filter((id) => id !== assetId))
    window.dispatchEvent(new CustomEvent('saved-assets-updated'))
  }

  async function createCollection() {
    if (!newCollectionName.trim()) return
    const res = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCollectionName.trim() }) })
    if (res.ok) {
      setNewCollectionName('')
      window.dispatchEvent(new CustomEvent('saved-assets-updated'))
    }
  }

  async function removeServerAsset(collectionId: string, assetId: string) {
    const res = await fetch(`/api/collections/${collectionId}/items/${assetId}`, { method: 'DELETE' })
    if (res.ok) {
      setSelectedIds((current) => current.filter((id) => id !== assetId))
      window.dispatchEvent(new CustomEvent('saved-assets-updated'))
    }
  }

  if (loading) return <div className="empty-state">Loading your saved collection…</div>

  const checkoutBar = allVisibleAssets.length ? (
    <form action="/api/checkout" method="POST" className="card">
      <div className="card-body flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="font-semibold">Selected items</div>
          <div className="text-sm text-gray-600">{selectedIds.length} of {allVisibleAssets.length} ready for checkout. The marketplace will skip license tiers you already own.</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary" onClick={toggleAll}>{selectedIds.length === allVisibleAssets.length ? 'Clear selection' : 'Select all'}</button>
          {selectedIds.map((assetId) => <input key={assetId} type="hidden" name="assetId" value={assetId} />)}
          <button className="btn" type="submit" disabled={!selectedIds.length}>Checkout selected</button>
        </div>
      </div>
    </form>
  ) : null

  if (mode === 'server') {
    return (
      <div className="space-y-6">
        {checkoutBar}
        <div className="card"><div className="card-body flex flex-col gap-3 md:flex-row"><input className="input" placeholder="New collection name" value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} /><button type="button" className="btn" onClick={() => void createCollection()}>Create collection</button></div></div>
        {collections.length ? collections.map((collection) => (
          <div key={collection.id} className="space-y-3">
            <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{collection.name}{collection.isDefault ? ' (Default)' : ''}</h2><div className="text-sm text-gray-500">{collection.items.length} item(s)</div></div>
            {collection.items.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{collection.items.map((item) => <div key={item.asset.id} className="card"><div className="card-body space-y-3"><div className="flex items-start justify-between gap-3"><div><a href={`/assets/${item.asset.id}`} className="text-lg font-semibold text-brand-700">{item.asset.title}</a><div className="text-sm text-gray-500">{item.asset.kind || item.asset.previewType} • {item.asset.category?.name || 'Uncategorized'}</div></div><input type="checkbox" checked={selectedIds.includes(item.asset.id)} onChange={() => toggleSelected(item.asset.id)} /></div><p className="line-clamp-3 text-sm text-gray-600">{item.asset.description}</p><div className="flex items-center justify-between gap-3"><div className="font-semibold">${(item.asset.priceCents / 100).toFixed(2)}</div><button type="button" className="btn-secondary" onClick={() => void removeServerAsset(collection.id, item.asset.id)}>Remove</button></div></div></div>)}</div> : <div className="empty-state">No items in this collection yet.</div>}
          </div>
        )) : <div className="empty-state">No collections yet.</div>}
      </div>
    )
  }

  if (!ids.length) return <div className="empty-state">No saved items yet. Use “Save to collection” on an asset page to build a shortlist.</div>

  return (
    <div className="space-y-4">
      {checkoutBar}
      {missingCount > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">{missingCount} saved item(s) are no longer available on this marketplace.</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {assets.map((asset) => (
          <div key={asset.id} className="card">
            <div className="card-body space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <a href={`/assets/${asset.id}`} className="text-lg font-semibold text-brand-700">{asset.title}</a>
                  <div className="text-sm text-gray-500">{asset.kind || asset.previewType} • {asset.category?.name || 'Uncategorized'}</div>
                </div>
                <input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={() => toggleSelected(asset.id)} />
              </div>
              <p className="line-clamp-3 text-sm text-gray-600">{asset.description}</p>
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">${(asset.priceCents / 100).toFixed(2)}</div>
                <button type="button" className="btn-secondary" onClick={() => removeLocal(asset.id)}>Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
