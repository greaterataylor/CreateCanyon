import { asArray, parseJsonValue, safeFilename, slugify } from './utils'

export type CategoryFieldRecord = {
  name: string
  label: string
  fieldType: string
  required: boolean
  sortOrder: number
  options?: string[]
}

export type CategoryRuleMap = Record<string, unknown>

export type ClientCategoryRecord = {
  id: string
  name: string
  slug?: string
  description?: string | null
  parentId?: string | null
  groupId?: string | null
  icon?: string | null
  bannerUrl?: string | null
  featured?: boolean
  allowedPreviewTypes: string[]
  allowedFileTypes: string[]
  allowedLicenseTypes: string[]
  defaultLicenseKey?: string | null
  taxCode?: string | null
  taxBehavior?: string | null
  fieldTemplates: CategoryFieldRecord[]
  rules: CategoryRuleMap
}

function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>
  return {}
}

function toFieldRecord(raw: any, index = 0): CategoryFieldRecord {
  const options = Array.isArray(raw?.options)
    ? raw.options.map((value: any) => String(value)).filter(Boolean)
    : asArray(raw?.options)
  return {
    name: String(raw?.name || '').trim(),
    label: String(raw?.label || raw?.name || '').trim(),
    fieldType: String(raw?.fieldType || raw?.type || 'text').trim(),
    required: Boolean(raw?.required),
    sortOrder: Number(raw?.sortOrder ?? index) || 0,
    ...(options.length ? { options } : {}),
  }
}

export function getCategoryFieldTemplates(category: any): CategoryFieldRecord[] {
  const explicit = Array.isArray(category?.fieldTemplates) ? category.fieldTemplates.map((item: any, index: number) => toFieldRecord(item, index)) : []
  const fromSchema = Array.isArray(asObject(category?.metadataSchema).fields)
    ? asObject(category?.metadataSchema).fields.map((item: any, index: number) => toFieldRecord(item, index))
    : []
  const chosen = explicit.length ? explicit : fromSchema
  return chosen
    .filter((field: CategoryFieldRecord) => field.name && field.label)
    .sort((a: CategoryFieldRecord, b: CategoryFieldRecord) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
}

export function getCategoryRuleMap(category: any): CategoryRuleMap {
  const rules: CategoryRuleMap = {}
  if (Array.isArray(category?.rules)) {
    for (const rule of category.rules) {
      const key = String(rule?.key || '').trim()
      if (!key) continue
      rules[key] = rule?.value
    }
  }
  return rules
}

export function getAllowedPreviewTypes(category: any) {
  return asArray(category?.allowedPreviewTypes).map((value) => value.toUpperCase())
}

export function getAllowedFileTypes(category: any) {
  return asArray(category?.allowedFileTypes).map((value) => value.toLowerCase())
}

export function getAllowedLicenseTypes(category: any) {
  const allowed = asArray(category?.allowedLicenseTypes).map((value) => slugify(value))
  return allowed.length ? allowed : ['standard', 'extended']
}

export function serializeCategoryForClient(category: any): ClientCategoryRecord {
  return {
    id: String(category.id),
    name: String(category.name),
    slug: category.slug || undefined,
    description: category.description || null,
    parentId: category.parentId || null,
    groupId: category.groupId || null,
    icon: category.icon || null,
    bannerUrl: category.bannerUrl || null,
    featured: Boolean(category.featured),
    allowedPreviewTypes: getAllowedPreviewTypes(category),
    allowedFileTypes: getAllowedFileTypes(category),
    allowedLicenseTypes: getAllowedLicenseTypes(category),
    defaultLicenseKey: category.defaultLicenseKey || null,
    taxCode: category.taxCode || null,
    taxBehavior: category.taxBehavior || null,
    fieldTemplates: getCategoryFieldTemplates(category),
    rules: getCategoryRuleMap(category),
  }
}

export function filenameExtension(filename: string) {
  const match = safeFilename(filename).toLowerCase().match(/\.([a-z0-9]{1,12})$/)
  return match ? match[1] : ''
}

export function mimeMatchesPattern(mimeType: string, pattern: string) {
  const normalizedMime = String(mimeType || '').toLowerCase().trim()
  const normalizedPattern = String(pattern || '').toLowerCase().trim()
  if (!normalizedMime || !normalizedPattern) return false
  if (normalizedPattern.endsWith('/*')) return normalizedMime.startsWith(normalizedPattern.slice(0, -1))
  return normalizedMime === normalizedPattern
}

export function allowedFileMatch(allowed: string[], filename: string, mimeType: string) {
  if (!allowed.length) return true
  const extension = filenameExtension(filename)
  const normalizedMime = String(mimeType || '').toLowerCase().trim()
  return allowed.some((pattern) => {
    const value = String(pattern || '').toLowerCase().trim()
    if (!value) return false
    if (value.includes('/')) return mimeMatchesPattern(normalizedMime, value)
    const normalizedExt = value.replace(/^\./, '')
    return extension === normalizedExt
  })
}

export function normalizeMetadataValue(field: CategoryFieldRecord, rawValue: unknown) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null
  if (field.fieldType === 'number' || field.fieldType === 'int' || field.fieldType === 'integer') {
    const numeric = Number(rawValue)
    return Number.isFinite(numeric) ? numeric : rawValue
  }
  if (field.fieldType === 'boolean') return rawValue === true || rawValue === 'true' || rawValue === '1' || rawValue === 1
  if (field.fieldType === 'json') {
    if (typeof rawValue === 'string') return parseJsonValue(rawValue, rawValue)
    return rawValue
  }
  if (Array.isArray(rawValue)) return rawValue.map((value) => String(value))
  return String(rawValue)
}

export function buildMetadataEntries(fieldTemplates: CategoryFieldRecord[], metadata: Record<string, unknown>) {
  return fieldTemplates
    .map((field, index) => {
      const normalized = normalizeMetadataValue(field, metadata[field.name])
      if (normalized === null) return null
      const textValue = typeof normalized === 'string' || typeof normalized === 'number' || typeof normalized === 'boolean' ? String(normalized) : null
      const jsonValue = textValue === null ? normalized : null
      return {
        fieldKey: field.name,
        fieldLabel: field.label,
        fieldType: field.fieldType,
        valueText: textValue,
        valueJson: jsonValue as any,
        sortOrder: field.sortOrder ?? index,
      }
    })
    .filter(Boolean)
}

export function validateStructuredMetadata(fieldTemplates: CategoryFieldRecord[], metadata: Record<string, unknown>) {
  const missing = fieldTemplates
    .filter((field) => field.required)
    .filter((field) => {
      const value = metadata[field.name]
      if (value === null || value === undefined) return true
      if (typeof value === 'string') return value.trim() === ''
      if (Array.isArray(value)) return value.length === 0
      return false
    })
    .map((field) => field.label)
  return { ok: missing.length === 0, missing }
}

export function ruleNumber(rules: CategoryRuleMap, key: string) {
  const value = rules[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  if (value && typeof value === 'object' && Number.isFinite(Number((value as any).count))) return Number((value as any).count)
  return null
}

export function ruleBoolean(rules: CategoryRuleMap, key: string) {
  const value = rules[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase())
  if (value && typeof value === 'object' && typeof (value as any).enabled === 'boolean') return Boolean((value as any).enabled)
  return null
}

export function ruleStringArray(rules: CategoryRuleMap, key: string) {
  const value = rules[key]
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
  if (value && typeof value === 'object') {
    if (Array.isArray((value as any).values)) return (value as any).values.map((item: any) => String(item)).filter(Boolean)
    if (Array.isArray((value as any).types)) return (value as any).types.map((item: any) => String(item)).filter(Boolean)
  }
  return asArray(value)
}
