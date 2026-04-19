'use client'

import { useEffect, useState } from 'react'

const KEY = 'znb-saved-assets'

function readIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || '[]')
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : []
  } catch {
    return []
  }
}

function writeIds(ids: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, JSON.stringify(Array.from(new Set(ids))))
  window.dispatchEvent(new CustomEvent('saved-assets-updated'))
}

export function getSavedAssetIds() {
  return readIds()
}

export default function SaveAssetButton({ assetId, signedIn = false, initiallySaved = false }: { assetId: string; signedIn?: boolean; initiallySaved?: boolean }) {
  const [saved, setSaved] = useState(initiallySaved)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (signedIn) {
      setSaved(initiallySaved)
      return
    }
    const sync = () => setSaved(readIds().includes(assetId))
    sync()
    window.addEventListener('saved-assets-updated', sync as EventListener)
    return () => window.removeEventListener('saved-assets-updated', sync as EventListener)
  }, [assetId, initiallySaved, signedIn])

  async function toggleServerSide() {
    setBusy(true)
    try {
      const res = await fetch('/api/assets/saved', {
        method: saved ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaved(Boolean(data.saved))
        window.dispatchEvent(new CustomEvent('saved-assets-updated'))
      }
    } finally {
      setBusy(false)
    }
  }

  function toggleLocal() {
    const current = readIds()
    if (current.includes(assetId)) writeIds(current.filter((id) => id !== assetId))
    else writeIds([...current, assetId])
    setSaved(!saved)
  }

  return (
    <button
      type="button"
      className="btn-secondary w-full"
      disabled={busy}
      onClick={() => {
        if (signedIn) void toggleServerSide()
        else toggleLocal()
      }}
    >
      {busy ? 'Saving…' : saved ? 'Saved to collection' : 'Save to collection'}
    </button>
  )
}
