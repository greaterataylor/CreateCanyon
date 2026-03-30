'use client'

import { useState } from 'react'

type PresignResponse = { url: string; storageKey: string; bucket: string }

async function presignUpload(file: File, categoryId: string): Promise<PresignResponse> {
  const res = await fetch('/api/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose: 'download',
      categoryId,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    }),
  })
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to prepare upload')
  return res.json()
}

export default function AssetVersionManager({ assetId, categoryId }: { assetId: string; categoryId: string }) {
  const [versionLabel, setVersionLabel] = useState('')
  const [changelog, setChangelog] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  return (
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault()
      setMessage(null)
      if (!file) {
        setMessage('Select a replacement download file first.')
        return
      }
      setBusy(true)
      try {
        const upload = await presignUpload(file, categoryId)
        const put = await fetch(upload.url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
        if (!put.ok) throw new Error('Version file upload failed')
        const res = await fetch(`/api/assets/${assetId}/versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionLabel, changelog, upload: { storageKey: upload.storageKey, filename: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, bucket: upload.bucket } }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Failed to submit version')
        setMessage('New version uploaded and submitted for review.')
        setVersionLabel('')
        setChangelog('')
        setFile(null)
      } catch (error: any) {
        setMessage(error.message || 'Upload failed')
      } finally {
        setBusy(false)
      }
    }}>
      {message && <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">{message}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">Version label</label>
          <input className="input" value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="1.1.0" required />
        </div>
        <div>
          <label className="label">Replacement download file</label>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
        </div>
      </div>
      <div>
        <label className="label">Changelog</label>
        <textarea className="input min-h-28" value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="What changed in this release?" />
      </div>
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload new version'}</button>
    </form>
  )
}
