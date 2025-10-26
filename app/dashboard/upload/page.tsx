'use client'
import { useEffect, useState } from 'react'

type Category = { id: string; name: string }

async function presign(key: string, contentType: string, isPublic: boolean) {
  const res = await fetch(`/api/upload/presign?key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(contentType)}&public=${isPublic?'1':'0'}`)
  if (!res.ok) throw new Error('Failed to presign')
  return res.json()
}

export default function UploadPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState(999)
  const [categoryId, setCategoryId] = useState('')
  const [previewType, setPreviewType] = useState<'IMAGE'|'AUDIO'|'VIDEO'|'CODE'|'FILE'>('IMAGE')
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [downloadFile, setDownloadFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/categories').then(r=>r.json()).then(setCategories)
  }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMessage(null)
    try {
      let previewKey = ''
      let downloadKey = ''
      if (previewFile) {
        const key = `previews/${Date.now()}-${previewFile.name}`
        const { url } = await presign(key, previewFile.type, true)
        await fetch(url, { method: 'PUT', body: previewFile, headers: { 'Content-Type': previewFile.type } })
        previewKey = key
      }
      if (!downloadFile) throw new Error('Download file required')
      {
        const key = `downloads/${Date.now()}-${downloadFile.name}`
        const { url } = await presign(key, downloadFile.type || 'application/octet-stream', false)
        await fetch(url, { method: 'PUT', body: downloadFile, headers: { 'Content-Type': downloadFile.type || 'application/octet-stream' } })
        downloadKey = key
      }
      const res = await fetch('/api/assets/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, priceCents: Number(price), categoryId, previewType, previewKey, downloadKey })
      })
      if (!res.ok) throw new Error('Failed to create asset')
      setMessage('Asset uploaded! Pending admin approval.')
      setTitle(''); setDescription(''); setPrice(999); setCategoryId(''); setPreviewFile(null); setDownloadFile(null)
    } catch (err:any) {
      setMessage(err.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Upload new asset</h1>
      {message && <div className="mb-3 text-sm">{message}</div>}
      <form className="space-y-3" onSubmit={onSubmit}>
        <div><label className="label">Title</label><input className="input" value={title} onChange={e=>setTitle(e.target.value)} required /></div>
        <div><label className="label">Description</label><textarea className="input" value={description} onChange={e=>setDescription(e.target.value)} required /></div>
        <div><label className="label">Price (cents)</label><input className="input" type="number" value={price} onChange={e=>setPrice(Number(e.target.value))} min={50} required /></div>
        <div>
          <label className="label">Category</label>
          <select className="input" value={categoryId} onChange={e=>setCategoryId(e.target.value)} required>
            <option value="">Select a category</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Preview Type</label>
          <select className="input" value={previewType} onChange={e=>setPreviewType(e.target.value as any)}>
            <option>IMAGE</option><option>AUDIO</option><option>VIDEO</option><option>CODE</option><option>FILE</option>
          </select>
        </div>
        <div><label className="label">Preview file (optional)</label><input type="file" onChange={e=>setPreviewFile(e.target.files?.[0] || null)} /></div>
        <div><label className="label">Download file (.zip recommended)</label><input type="file" onChange={e=>setDownloadFile(e.target.files?.[0] || null)} required /></div>
        <button className="btn" disabled={busy}>{busy ? 'Uploading...' : 'Upload'}</button>
      </form>
    </div>
  )
}
