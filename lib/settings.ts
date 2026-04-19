import { slugify } from './utils'

export type LicenseTemplateRecord = {
  key: string
  name: string
  standardLabel: string
  standardText: string
  extendedLabel: string
  extendedText: string
  extendedMultiplier: number
  isDefault?: boolean
}

export type HomeContentRecord = {
  eyebrow: string
  title: string
  description: string
  primaryCtaLabel: string
  primaryCtaHref: string
  secondaryCtaLabel: string
  secondaryCtaHref: string
  trustBadges: string[]
}

function asSettingsObject(settings: unknown): Record<string, any> {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) return settings as Record<string, any>
  return {}
}

export function getSiteSettings(settings: unknown) {
  return asSettingsObject(settings)
}

export function defaultLicenseTemplates(): LicenseTemplateRecord[] {
  return [
    {
      key: 'standard',
      name: 'Standard + Extended',
      standardLabel: 'Standard',
      standardText: 'Single-seat commercial use. No redistribution, re-sale, or sublicensing of the standalone asset.',
      extendedLabel: 'Extended',
      extendedText: 'Broader commercial use for teams and client delivery. Redistribution of the standalone asset remains prohibited.',
      extendedMultiplier: 2,
      isDefault: true,
    },
  ]
}

export function getLicenseTemplates(settings: unknown): LicenseTemplateRecord[] {
  const raw = asSettingsObject(settings).licenseTemplates
  if (!Array.isArray(raw) || raw.length === 0) return defaultLicenseTemplates()
  const parsed = raw
    .map((item) => ({
      key: typeof item?.key === 'string' && item.key ? item.key : slugify(String(item?.name || 'template')),
      name: typeof item?.name === 'string' && item.name ? item.name : 'License template',
      standardLabel: typeof item?.standardLabel === 'string' && item.standardLabel ? item.standardLabel : 'Standard',
      standardText: typeof item?.standardText === 'string' ? item.standardText : '',
      extendedLabel: typeof item?.extendedLabel === 'string' && item.extendedLabel ? item.extendedLabel : 'Extended',
      extendedText: typeof item?.extendedText === 'string' ? item.extendedText : '',
      extendedMultiplier: Number(item?.extendedMultiplier) > 0 ? Number(item.extendedMultiplier) : 2,
      isDefault: Boolean(item?.isDefault),
    }))
    .filter((item) => item.key && item.name)
  return parsed.length ? parsed : defaultLicenseTemplates()
}

export function upsertLicenseTemplate(settings: unknown, template: LicenseTemplateRecord) {
  const base = asSettingsObject(settings)
  const templates = getLicenseTemplates(settings)
  const withoutCurrent = templates.filter((item) => item.key !== template.key)
  const next = [...withoutCurrent, template].sort((a, b) => a.name.localeCompare(b.name))
  const normalized = next.map((item) => ({ ...item, isDefault: template.isDefault ? item.key === template.key : item.isDefault }))
  if (!normalized.some((item) => item.isDefault)) normalized[0].isDefault = true
  return { ...base, licenseTemplates: normalized }
}

export function deleteLicenseTemplate(settings: unknown, key: string) {
  const base = asSettingsObject(settings)
  const remaining = getLicenseTemplates(settings).filter((item) => item.key !== key)
  if (remaining.length === 0) return { ...base, licenseTemplates: defaultLicenseTemplates() }
  if (!remaining.some((item) => item.isDefault)) remaining[0].isDefault = true
  return { ...base, licenseTemplates: remaining }
}

export function getHomeContent(settings: unknown, siteName: string): HomeContentRecord {
  const base = asSettingsObject(settings)
  const hero = asSettingsObject(base.hero)
  const trustBadges = Array.isArray(hero.trustBadges)
    ? hero.trustBadges.map((item: any) => String(item)).filter(Boolean)
    : [
        'Site-scoped taxonomy',
        'Seller storefronts',
        'Secure downloads',
        'Buyer receipts',
      ]
  return {
    eyebrow: typeof hero.eyebrow === 'string' && hero.eyebrow ? hero.eyebrow : 'ZenBinary Marketplace Network',
    title: typeof hero.title === 'string' && hero.title ? hero.title : siteName,
    description:
      typeof hero.description === 'string' && hero.description
        ? hero.description
        : `Buy and sell curated digital products on ${siteName} with reusable multi-site marketplace infrastructure.`,
    primaryCtaLabel: typeof hero.primaryCtaLabel === 'string' && hero.primaryCtaLabel ? hero.primaryCtaLabel : 'Search marketplace',
    primaryCtaHref: typeof hero.primaryCtaHref === 'string' && hero.primaryCtaHref ? hero.primaryCtaHref : '/search',
    secondaryCtaLabel: typeof hero.secondaryCtaLabel === 'string' && hero.secondaryCtaLabel ? hero.secondaryCtaLabel : 'Open dashboard',
    secondaryCtaHref: typeof hero.secondaryCtaHref === 'string' && hero.secondaryCtaHref ? hero.secondaryCtaHref : '/dashboard',
    trustBadges,
  }
}

export function getLegalDocuments(settings: unknown) {
  const docs = asSettingsObject(settings).legalDocuments
  if (!Array.isArray(docs)) return [] as Array<{ title: string; body: string }>
  return docs
    .map((doc) => ({ title: String(doc?.title || '').trim(), body: String(doc?.body || '').trim() }))
    .filter((doc) => doc.title && doc.body)
}

export function getEmailTemplates(settings: unknown) {
  const templates = asSettingsObject(settings).emailTemplates
  if (!Array.isArray(templates)) return [] as Array<{ key: string; subject: string; body: string }>
  return templates
    .map((template) => ({
      key: slugify(String(template?.key || template?.subject || 'template')),
      subject: String(template?.subject || '').trim(),
      body: String(template?.body || '').trim(),
    }))
    .filter((template) => template.key && template.subject)
}
