import { slugify } from './utils'
import {
  allowedFileMatch,
  getAllowedFileTypes,
  getAllowedLicenseTypes,
  getAllowedPreviewTypes,
  getCategoryFieldTemplates,
  getCategoryRuleMap,
  mimeMatchesPattern,
  ruleBoolean,
  ruleNumber,
  ruleStringArray,
  validateStructuredMetadata,
} from './taxonomy'

export type UploadedFileDescriptor = {
  filename: string
  mimeType: string
  sizeBytes: number
}

export type AssetRuleValidationInput = {
  previewType: string
  priceCents: number
  previewUpload?: UploadedFileDescriptor | null
  downloadUpload: UploadedFileDescriptor
}

export function normalizeLicenseOptions(data: any, category: any) {
  const allowedLicenseTypes = getAllowedLicenseTypes(category)
  const incoming = Array.isArray(data.licenseOptions) && data.licenseOptions.length
    ? data.licenseOptions.filter((option: any) => option && option.enabled !== false)
    : [
        {
          slug: 'standard',
          name: data.standardLicenseLabel || 'Standard',
          description: 'Single seat commercial use.',
          licenseText: data.standardLicenseText || 'Single seat commercial use. No redistribution, resale, or sub-licensing.',
          priceCents: data.priceCents,
          sortOrder: 0,
        },
        {
          slug: 'extended',
          name: data.extendedLicenseLabel || 'Extended',
          description: 'Wider commercial usage and team/internal client delivery rights.',
          licenseText: data.extendedLicenseText || 'Extended commercial use with team/client delivery. Redistribution as a standalone product is prohibited.',
          priceCents: data.extendedPriceCents || Math.max(data.priceCents * 2, data.priceCents + 500),
          sortOrder: 1,
        },
      ]

  const seen = new Set<string>()
  const normalized = incoming
    .map((option: any, index: number) => ({
      slug: slugify(String(option.slug || option.name || `license-${index + 1}`)),
      name: String(option.name || '').trim(),
      description: String(option.description || '').trim() || undefined,
      licenseText: String(option.licenseText || '').trim() || undefined,
      priceCents: Math.max(Number(option.priceCents || 0), 50),
      sortOrder: Number(option.sortOrder ?? index) || index,
    }))
    .filter((option: any) => option.slug && option.name)
    .filter((option: any) => {
      if (seen.has(option.slug)) return false
      seen.add(option.slug)
      return true
    })

  if (!normalized.length) return { error: 'At least one license option is required.' }
  const disallowed = normalized.filter((option: any) => allowedLicenseTypes.length && !allowedLicenseTypes.includes(option.slug))
  if (disallowed.length) return { error: `These license types are not allowed for the selected category: ${disallowed.map((item: any) => item.slug).join(', ')}` }
  return { options: normalized }
}

export function validateAgainstCategoryRules(category: any, data: AssetRuleValidationInput, metadata: Record<string, unknown>) {
  const rules = getCategoryRuleMap(category)
  const fieldTemplates = getCategoryFieldTemplates(category)
  const allowedPreviewTypes = getAllowedPreviewTypes(category)
  const allowedFileTypes = getAllowedFileTypes(category)
  const previewMimePatterns = ruleStringArray(rules, 'allowedPreviewMimeTypes').map((value: string) => value.toLowerCase())
  const downloadMimePatterns = ruleStringArray(rules, 'allowedDownloadMimeTypes').map((value: string) => value.toLowerCase())
  const minPriceCents = ruleNumber(rules, 'minPriceCents')
  const maxPriceCents = ruleNumber(rules, 'maxPriceCents')
  const requirePreview = ruleBoolean(rules, 'requirePreview') || Boolean(ruleNumber(rules, 'minPreviewCount'))
  const maxDownloadSizeBytes = ruleNumber(rules, 'maxDownloadSizeBytes')
  const maxPreviewSizeBytes = ruleNumber(rules, 'maxPreviewSizeBytes')

  if (allowedPreviewTypes.length && !allowedPreviewTypes.includes(String(data.previewType || '').toUpperCase())) {
    return { error: 'This preview type is not allowed for the selected category.' }
  }
  if (requirePreview && !data.previewUpload) {
    return { error: 'This category requires at least one preview upload.' }
  }
  if (minPriceCents !== null && Number(data.priceCents) < minPriceCents) {
    return { error: `The minimum base price for this category is ${minPriceCents} cents.` }
  }
  if (maxPriceCents !== null && Number(data.priceCents) > maxPriceCents) {
    return { error: `The maximum base price for this category is ${maxPriceCents} cents.` }
  }
  if (maxDownloadSizeBytes !== null && Number(data.downloadUpload?.sizeBytes || 0) > maxDownloadSizeBytes) {
    return { error: 'The download file is too large for this category.' }
  }
  if (maxPreviewSizeBytes !== null && Number(data.previewUpload?.sizeBytes || 0) > maxPreviewSizeBytes) {
    return { error: 'The preview file is too large for this category.' }
  }
  if (allowedFileTypes.length && !allowedFileMatch(allowedFileTypes, data.downloadUpload.filename, data.downloadUpload.mimeType)) {
    return { error: 'This download file type is not allowed for the selected category.' }
  }
  if (downloadMimePatterns.length && !downloadMimePatterns.some((pattern: string) => mimeMatchesPattern(data.downloadUpload.mimeType, pattern))) {
    return { error: 'This download MIME type is not allowed for the selected category.' }
  }
  if (data.previewUpload && previewMimePatterns.length && !previewMimePatterns.some((pattern: string) => mimeMatchesPattern(data.previewUpload!.mimeType, pattern))) {
    return { error: 'This preview MIME type is not allowed for the selected category.' }
  }
  const metadataValidation = validateStructuredMetadata(fieldTemplates, metadata)
  if (!metadataValidation.ok) {
    return { error: `Missing required metadata fields: ${metadataValidation.missing.join(', ')}` }
  }
  return { rules, fieldTemplates }
}
