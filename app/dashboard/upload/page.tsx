'use client'

import { useEffect, useMemo, useState } from 'react'

type CategoryField = { name: string; label: string; fieldType: string; required?: boolean; options?: string[] }
type Category = {
  id: string
  name: string
  description?: string | null
  fieldTemplates: CategoryField[]
  rules?: Record<string, unknown>
  allowedPreviewTypes?: string[] | null
  allowedFileTypes?: string[] | null
  allowedLicenseTypes?: string[] | null
  defaultLicenseKey?: string | null
  taxCode?: string | null
  taxBehavior?: 'exclusive' | 'inclusive' | null
}
type LicenseTemplate = {
  key: string
  name: string
  standardLabel: string
  standardText: string
  extendedLabel: string
  extendedText: string
  extendedMultiplier: number
  isDefault?: boolean
}
type PresignResponse = { url: string; storageKey: string; bucket: string; uploadGroup?: string }
type LicenseOptionForm = {
  slug: string
  name: string
  description: string
  licenseText: string
  priceCents: number
  enabled: boolean
}

const defaultPreviewTypes = ['IMAGE', 'AUDIO', 'VIDEO', 'CODE', 'FILE', 'PDF', 'FONT']
const defaultLicenseTypes = ['standard', 'extended']

function randomUploadGroup() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `upload-${Date.now()}`
}

async function presignUpload(purpose: 'preview' | 'download', file: File, categoryId: string, uploadGroup: string): Promise<PresignResponse> {
  const res = await fetch('/api/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purpose,
      categoryId,
      uploadGroup,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    }),
  })
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to prepare upload')
  return res.json()
}

function titleFromSlug(slug: string) {
  return slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function buildLicenseDefaults(allowedLicenseTypes: string[], template: LicenseTemplate | undefined, basePrice: number): LicenseOptionForm[] {
  const choices = allowedLicenseTypes.length ? allowedLicenseTypes : defaultLicenseTypes
  return choices.map((slug, index) => {
    if (slug === 'standard') {
      return {
        slug,
        name: template?.standardLabel || 'Standard',
        description: 'Single-seat or single-use commercial license.',
        licenseText: template?.standardText || 'Single-seat commercial use. No redistribution, resale, or sublicensing.',
        priceCents: Math.max(basePrice, 50),
        enabled: true,
      }
    }
    if (slug === 'extended') {
      return {
        slug,
        name: template?.extendedLabel || 'Extended',
        description: 'Broader commercial use, teams, and client delivery rights.',
        licenseText: template?.extendedText || 'Broader commercial use for teams and client delivery. Redistribution of the standalone asset remains prohibited.',
        priceCents: Math.max(Math.round(basePrice * Number(template?.extendedMultiplier || 2)), basePrice + 500, 50),
        enabled: true,
      }
    }
    const multiplier = slug === 'team' ? 3 : slug === 'enterprise' ? 5 : slug === 'commercial' ? 2.5 : index + 2
    return {
      slug,
      name: titleFromSlug(slug),
      description: `${titleFromSlug(slug)} license for broader internal or commercial usage rights.`,
      licenseText: `${titleFromSlug(slug)} license terms apply. Use is broader than the standard license but redistribution of the standalone asset remains prohibited unless separately agreed.`,
      priceCents: Math.max(Math.round(basePrice * multiplier), basePrice + 1000, 50),
      enabled: slug === 'team' || slug === 'commercial',
    }
  })
}

function formatRuleValue(value: unknown) {
  if (value === null || value === undefined || value === '') return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export default function UploadPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [licenseTemplates, setLicenseTemplates] = useState<LicenseTemplate[]>([])
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [shortDescription, setShortDescription] = useState('')
  const [price, setPrice] = useState(999)
  const [categoryId, setCategoryId] = useState('')
  const [kind, setKind] = useState<'IMAGE' | 'GRAPHIC' | 'AUDIO' | 'VIDEO' | 'FONT' | 'CODE' | 'DOCUMENT' | 'TEMPLATE' | 'BUNDLE' | 'OTHER'>('OTHER')
  const [previewType, setPreviewType] = useState<'IMAGE' | 'AUDIO' | 'VIDEO' | 'CODE' | 'FILE' | 'PDF' | 'FONT'>('IMAGE')
  const [tags, setTags] = useState('')
  const [extraMetadataJson, setExtraMetadataJson] = useState('{}')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('')
  const [taxCode, setTaxCode] = useState('')
  const [taxBehavior, setTaxBehavior] = useState<'exclusive' | 'inclusive'>('exclusive')
  const [licenseOptions, setLicenseOptions] = useState<LicenseOptionForm[]>([])
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [downloadFile, setDownloadFile] = useState<File | null>(null)
  const [uploadGroup, setUploadGroup] = useState(randomUploadGroup())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/categories', { cache: 'no-store' }).then((r) => r.json()).then((data) => setCategories(Array.isArray(data) ? data : [])).catch(() => setCategories([]))
    fetch('/api/licenses', { cache: 'no-store' }).then((r) => r.json()).then((data) => {
      const templates = Array.isArray(data) ? data : []
      setLicenseTemplates(templates)
      const chosen = templates.find((item: any) => item.isDefault) || templates[0]
      if (chosen) setSelectedTemplateKey(chosen.key)
    }).catch(() => setLicenseTemplates([]))
  }, [])

  const selectedCategory = useMemo(() => categories.find((category) => category.id === categoryId) || null, [categories, categoryId])
  const selectedTemplate = useMemo(() => licenseTemplates.find((item) => item.key === selectedTemplateKey), [licenseTemplates, selectedTemplateKey])
  const categoryFields = selectedCategory?.fieldTemplates || []
  const allowedPreviewTypes = selectedCategory?.allowedPreviewTypes?.length ? selectedCategory.allowedPreviewTypes : defaultPreviewTypes
  const allowedLicenseTypes = selectedCategory?.allowedLicenseTypes?.length ? selectedCategory.allowedLicenseTypes : defaultLicenseTypes
  const fileAccept = selectedCategory?.allowedFileTypes?.length ? selectedCategory.allowedFileTypes.join(',') : undefined

  useEffect(() => {
    if (!selectedCategory) return
    if (selectedCategory.defaultLicenseKey) setSelectedTemplateKey(selectedCategory.defaultLicenseKey)
    if (selectedCategory.taxCode) setTaxCode(selectedCategory.taxCode)
    if (selectedCategory.taxBehavior === 'inclusive' || selectedCategory.taxBehavior === 'exclusive') setTaxBehavior(selectedCategory.taxBehavior)
  }, [selectedCategory])

  useEffect(() => {
    if (!allowedPreviewTypes.includes(previewType)) setPreviewType((allowedPreviewTypes[0] || 'IMAGE') as any)
  }, [allowedPreviewTypes, previewType])

  useEffect(() => {
    setLicenseOptions(buildLicenseDefaults(allowedLicenseTypes, selectedTemplate, price))
  }, [allowedLicenseTypes, selectedTemplate, price])

  const setLicenseField = (slugValue: string, key: keyof LicenseOptionForm, value: string | number | boolean) => {
    setLicenseOptions((current) => current.map((option) => option.slug === slugValue ? { ...option, [key]: value } : option))
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)

    try {
      if (!categoryId) throw new Error('Select a category')
      if (!downloadFile) throw new Error('Download file required')

      for (const field of categoryFields) {
        if (!field.required) continue
        if (!(fieldValues[field.name] || '').trim()) throw new Error(`Please complete the “${field.label}” field.`)
      }

      let previewUpload: PresignResponse | undefined
      let downloadUpload: PresignResponse
      if (previewFile) {
        previewUpload = await presignUpload('preview', previewFile, categoryId, uploadGroup)
        const uploadRes = await fetch(previewUpload.url, { method: 'PUT', headers: { 'Content-Type': previewFile.type || 'application/octet-stream' }, body: previewFile })
        if (!uploadRes.ok) throw new Error('Preview upload failed')
      }
      downloadUpload = await presignUpload('download', downloadFile, categoryId, uploadGroup)
      const downloadUploadRes = await fetch(downloadUpload.url, { method: 'PUT', headers: { 'Content-Type': downloadFile.type || 'application/octet-stream' }, body: downloadFile })
      if (!downloadUploadRes.ok) throw new Error('Download upload failed')

      let extraMetadata: Record<string, unknown> = {}
      try {
        extraMetadata = JSON.parse(extraMetadataJson || '{}')
      } catch {
        throw new Error('Advanced metadata must be valid JSON')
      }

      const metadata = {
        ...extraMetadata,
        ...Object.fromEntries(Object.entries(fieldValues).filter(([, value]) => value !== '')),
        licenseTemplateKey: selectedTemplateKey,
      }

      const res = await fetch('/api/assets/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          slug: slug || undefined,
          description,
          shortDescription,
          priceCents: Number(price),
          categoryId,
          kind,
          previewType,
          previewUpload: previewUpload ? { storageKey: previewUpload.storageKey, filename: previewFile!.name, mimeType: previewFile!.type || 'application/octet-stream', sizeBytes: previewFile!.size, bucket: previewUpload.bucket } : undefined,
          downloadUpload: { storageKey: downloadUpload.storageKey, filename: downloadFile.name, mimeType: downloadFile.type || 'application/octet-stream', sizeBytes: downloadFile.size, bucket: downloadUpload.bucket },
          metadata,
          licenseTemplateKey: selectedTemplateKey || undefined,
          taxCode: taxCode || undefined,
          taxBehavior,
          tags: tags.split(',').map((v) => v.trim()).filter(Boolean),
          licenseOptions: licenseOptions.filter((option) => option.enabled).map((option, index) => ({ ...option, sortOrder: index })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to create asset')

      setMessage('Asset uploaded and submitted for review.')
      setTitle('')
      setSlug('')
      setDescription('')
      setShortDescription('')
      setCategoryId('')
      setTags('')
      setPreviewFile(null)
      setDownloadFile(null)
      setFieldValues({})
      setExtraMetadataJson('{}')
      setUploadGroup(randomUploadGroup())
    } catch (error: any) {
      setMessage(error.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Upload new asset</h1>
        <p className="text-gray-600">Category-aware upload form with structured metadata, site-managed license templates, and server-scoped upload keys.</p>
      </div>
      {message && <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">{message}</div>}
      <form className="space-y-6" onSubmit={onSubmit}>
        <div className="card"><div className="card-body space-y-4">
          <h2 className="font-semibold">Core listing</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="label">Title</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
            <div><label className="label">Slug (optional)</label><input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-asset-slug" /></div>
          </div>
          <div><label className="label">Short description</label><input className="input" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} placeholder="One-line summary" /></div>
          <div><label className="label">Description</label><textarea className="input min-h-32" value={description} onChange={(e) => setDescription(e.target.value)} required /></div>
          <div className="grid gap-4 md:grid-cols-4">
            <div><label className="label">Base price (cents)</label><input className="input" type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} min={50} required /></div>
            <div><label className="label">Category</label><select className="input" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setFieldValues({}) }} required><option value="">Select a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
            <div><label className="label">Asset kind</label><select className="input" value={kind} onChange={(e) => setKind(e.target.value as any)}><option>IMAGE</option><option>GRAPHIC</option><option>AUDIO</option><option>VIDEO</option><option>FONT</option><option>CODE</option><option>DOCUMENT</option><option>TEMPLATE</option><option>BUNDLE</option><option>OTHER</option></select></div>
            <div><label className="label">Preview type</label><select className="input" value={previewType} onChange={(e) => setPreviewType(e.target.value as any)}>{allowedPreviewTypes.map((type) => <option key={type}>{type}</option>)}</select></div>
          </div>
          <div><label className="label">Tags</label><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="logo, business, dark-mode" /></div>
          {selectedCategory?.description && <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-800">{selectedCategory.description}</div>}
          {selectedCategory?.rules && Object.keys(selectedCategory.rules).length > 0 && (
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="font-medium">Category rules</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2 text-sm text-gray-600">
                {Object.entries(selectedCategory.rules).map(([key, value]) => <div key={key}><span className="font-medium">{key}:</span> {formatRuleValue(value)}</div>)}
              </div>
            </div>
          )}
        </div></div>

        <div className="card"><div className="card-body space-y-4">
          <h2 className="font-semibold">Licensing</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div><label className="label">Template</label><select className="input" value={selectedTemplateKey} onChange={(e) => setSelectedTemplateKey(e.target.value)}>{licenseTemplates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}</select></div>
            <div className="md:col-span-2 text-sm text-gray-500">Allowed license tiers for this category: {allowedLicenseTypes.join(', ')}</div>
          </div>
          <div className="space-y-4">
            {licenseOptions.map((option, index) => (
              <div key={option.slug} className="rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{titleFromSlug(option.slug)}</div>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={option.enabled} onChange={(e) => setLicenseField(option.slug, 'enabled', e.target.checked)} disabled={option.slug === 'standard'} />
                    Enabled
                  </label>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div><label className="label">Display name</label><input className="input" value={option.name} onChange={(e) => setLicenseField(option.slug, 'name', e.target.value)} disabled={!option.enabled} required={option.enabled} /></div>
                  <div><label className="label">Price (cents)</label><input className="input" type="number" min={50} value={option.priceCents} onChange={(e) => setLicenseField(option.slug, 'priceCents', Number(e.target.value))} disabled={!option.enabled} required={option.enabled} /></div>
                </div>
                <div><label className="label">Description</label><input className="input" value={option.description} onChange={(e) => setLicenseField(option.slug, 'description', e.target.value)} disabled={!option.enabled} /></div>
                <div><label className="label">License text</label><textarea className="input min-h-28" value={option.licenseText} onChange={(e) => setLicenseField(option.slug, 'licenseText', e.target.value)} disabled={!option.enabled} /></div>
                <input type="hidden" value={index} />
              </div>
            ))}
          </div>
        </div></div>

        <div className="card"><div className="card-body space-y-4">
          <h2 className="font-semibold">Tax settings</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="label">Tax code</label><input className="input" value={taxCode} onChange={(e) => setTaxCode(e.target.value)} placeholder="txcd_99999999" /></div>
            <div><label className="label">Tax behavior</label><select className="input" value={taxBehavior} onChange={(e) => setTaxBehavior(e.target.value as 'exclusive' | 'inclusive')}><option value="exclusive">Exclusive</option><option value="inclusive">Inclusive</option></select></div>
          </div>
        </div></div>

        <div className="card"><div className="card-body space-y-4">
          <h2 className="font-semibold">Structured metadata</h2>
          {categoryFields.length ? <div className="grid gap-4 md:grid-cols-2">{categoryFields.map((field) => <div key={field.name} className={field.fieldType === 'textarea' ? 'md:col-span-2' : ''}><label className="label">{field.label}</label>{field.fieldType === 'select' ? <select className="input" value={fieldValues[field.name] || ''} onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.name]: e.target.value }))} required={Boolean(field.required)}><option value="">Select</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select> : field.fieldType === 'textarea' ? <textarea className="input min-h-28" value={fieldValues[field.name] || ''} onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.name]: e.target.value }))} required={Boolean(field.required)} /> : field.fieldType === 'number' ? <input className="input" type="number" value={fieldValues[field.name] || ''} onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.name]: e.target.value }))} required={Boolean(field.required)} /> : <input className="input" value={fieldValues[field.name] || ''} onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.name]: e.target.value }))} required={Boolean(field.required)} />}</div>)}</div> : <div className="empty-state">This category does not define structured metadata fields yet.</div>}
          <div><label className="label">Advanced metadata JSON</label><textarea className="input min-h-32 font-mono text-xs" value={extraMetadataJson} onChange={(e) => setExtraMetadataJson(e.target.value)} /></div>
        </div></div>

        <div className="card"><div className="card-body space-y-4">
          <h2 className="font-semibold">Files</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="label">Preview file (optional)</label><input type="file" onChange={(e) => setPreviewFile(e.target.files?.[0] || null)} /></div>
            <div><label className="label">Download file</label><input type="file" accept={fileAccept} onChange={(e) => setDownloadFile(e.target.files?.[0] || null)} required /></div>
          </div>
          {selectedCategory?.allowedFileTypes?.length ? <div className="text-sm text-gray-500">Allowed download file types: {selectedCategory.allowedFileTypes.join(', ')}</div> : null}
          <button className="btn" disabled={busy}>{busy ? 'Uploading...' : 'Upload asset'}</button>
        </div></div>
      </form>
    </div>
  )
}
