type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject
  return {}
}

export function normalizeSiteHost(host: string | null | undefined) {
  if (!host) return null
  return host.toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/:\d+$/, '').trim()
}

export function isLocalSiteHost(host: string | null | undefined) {
  const normalized = normalizeSiteHost(host)
  return !!normalized && (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '127.0.0.1')
}

export function mergeJsonObjects(base: unknown, override: unknown): JsonObject {
  const baseObject = asObject(base)
  const overrideObject = asObject(override)
  const merged: JsonObject = { ...baseObject }

  for (const [key, value] of Object.entries(overrideObject)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && key in baseObject) {
      merged[key] = mergeJsonObjects(baseObject[key], value)
      continue
    }
    merged[key] = value
  }

  return merged
}

export type SiteBrandPreset = {
  slug: string
  name: string
  primaryDomain: string
  domains: string[]
  hostHints: string[]
  seoTitle: string
  seoDescription: string
  logoUrl: string
  faviconUrl: string
  theme: JsonObject
  settings: JsonObject
  categories: string[]
}

function buildTheme(brand: Record<string, string>, backgroundColor: string) {
  return {
    brand,
    backgroundColor,
  } satisfies JsonObject
}

function buildBrandAssets(slug: string) {
  return {
    logoUrl: `/${slug}-Logo.png`,
    faviconUrl: `/${slug}-Favicon.png`,
  }
}

function buildSettings(input: {
  eyebrow: string
  title: string
  description: string
  trustBadges: string[]
  primaryCtaLabel?: string
  primaryCtaHref?: string
  secondaryCtaLabel?: string
  secondaryCtaHref?: string
}) {
  return {
    hero: {
      eyebrow: input.eyebrow,
      title: input.title,
      description: input.description,
      primaryCtaLabel: input.primaryCtaLabel || 'Search marketplace',
      primaryCtaHref: input.primaryCtaHref || '/search',
      secondaryCtaLabel: input.secondaryCtaLabel || 'Open dashboard',
      secondaryCtaHref: input.secondaryCtaHref || '/dashboard',
      trustBadges: input.trustBadges,
    },
  } satisfies JsonObject
}

const createCanyonTheme = buildTheme(
  {
    '50': '#f5f5ff',
    '100': '#e5e7ff',
    '200': '#c7ccff',
    '300': '#a4adff',
    '400': '#7e8bff',
    '500': '#5c6cff',
    '600': '#424fe6',
    '700': '#333cc0',
    '800': '#2a3199',
    '900': '#1d2266',
  },
  '#f9fafb',
)

const graphicGroundsTheme = buildTheme(
  {
    '50': '#fdf2f8',
    '100': '#fce7f3',
    '200': '#fbcfe8',
    '300': '#f9a8d4',
    '400': '#f472b6',
    '500': '#ec4899',
    '600': '#db2777',
    '700': '#be185d',
    '800': '#9d174d',
    '900': '#831843',
  },
  '#fffafc',
)

const melodyMerchantTheme = buildTheme(
  {
    '50': '#fff7ed',
    '100': '#ffedd5',
    '200': '#fed7aa',
    '300': '#fdba74',
    '400': '#fb923c',
    '500': '#f97316',
    '600': '#ea580c',
    '700': '#c2410c',
    '800': '#9a3412',
    '900': '#7c2d12',
  },
  '#fffaf5',
)

const programPlazaTheme = buildTheme(
  {
    '50': '#ecfdf5',
    '100': '#d1fae5',
    '200': '#a7f3d0',
    '300': '#6ee7b7',
    '400': '#34d399',
    '500': '#10b981',
    '600': '#059669',
    '700': '#047857',
    '800': '#065f46',
    '900': '#064e3b',
  },
  '#f7fcfa',
)

const fileFoyerTheme = buildTheme(
  {
    '50': '#f0f9ff',
    '100': '#e0f2fe',
    '200': '#bae6fd',
    '300': '#7dd3fc',
    '400': '#38bdf8',
    '500': '#0ea5e9',
    '600': '#0284c7',
    '700': '#0369a1',
    '800': '#075985',
    '900': '#0c4a6e',
  },
  '#f7fbff',
)

export const SITE_BRAND_PRESETS: SiteBrandPreset[] = [
  {
    slug: 'CreateCanyon',
    name: 'CreateCanyon',
    primaryDomain: 'createcanyon.com',
    domains: ['createcanyon.com', 'www.createcanyon.com', 'createcanyon.localhost', 'create.localhost'],
    hostHints: ['createcanyon'],
    seoTitle: 'CreateCanyon - Canyon of Creativity',
    seoDescription: 'Buy and sell images, graphics, audio, video, fonts, code, templates, and documents.',
    ...buildBrandAssets('CreateCanyon'),
    theme: createCanyonTheme,
    settings: buildSettings({
      eyebrow: 'Canyon of Creativity',
      title: 'CreateCanyon',
      description: 'Discover curated images, graphics, audio, video, fonts, code, templates, documents, and bundles in one marketplace.',
      trustBadges: ['Images, audio, code, docs', 'Seller storefronts', 'Secure downloads', 'Site-scoped taxonomy'],
    }),
    categories: ['Images', 'Photos', 'Graphics', 'Audio', 'Clips', 'Movies', 'Fonts', 'Code', 'Documents', 'Templates', 'Bundles'],
  },
  {
    slug: 'GraphicGrounds',
    name: 'GraphicGrounds',
    primaryDomain: 'graphicgrounds.com',
    domains: ['graphicgrounds.com', 'www.graphicgrounds.com', 'graphicgrounds.localhost', 'graphic.localhost'],
    hostHints: ['graphicgrounds'],
    seoTitle: 'GraphicGround - Grounded in Graphics',
    seoDescription: 'Curated visual design assets for creatives.',
    ...buildBrandAssets('GraphicGrounds'),
    theme: graphicGroundsTheme,
    settings: buildSettings({
      eyebrow: 'Grounded in Graphics',
      title: 'GraphicGrounds',
      description: 'Browse curated photos, vectors, illustrations, icons, mockups, textures, and UI kits for designers and studios.',
      trustBadges: ['Graphics + photos', 'Illustrations + icons', 'Mockups + textures', 'Curated visual catalog'],
    }),
    categories: ['Photos', 'Vectors', 'Illustrations', 'Icons', 'Backgrounds', 'Mockups', 'Textures', 'UI Kits'],
  },
  {
    slug: 'MelodyMerchant',
    name: 'MelodyMerchant',
    primaryDomain: 'melodymerchant.com',
    domains: [
      'melodymerchant.com',
      'www.melodymerchant.com',
      'melodymerchant.localhost',
      'melody.localhost',
      'melodymercant.com',
      'www.melodymercant.com',
      'melodymercant.localhost',
    ],
    hostHints: ['melodymerchant', 'melodymercant'],
    seoTitle: 'MelodyMerchant - Source of Sound',
    seoDescription: 'Marketplace for loops, samples, beats, stems, and sound design tools.',
    ...buildBrandAssets('MelodyMerchant'),
    theme: melodyMerchantTheme,
    settings: buildSettings({
      eyebrow: 'Your Source of Sound',
      title: 'MelodyMerchant',
      description: 'Shop loops, samples, beats, stems, presets, and sound design resources for producers, musicians, and audio teams.',
      trustBadges: ['Loops + samples', 'Beats + stems', 'Presets + FX', 'Audio-focused discovery'],
    }),
    categories: ['Music', 'Loops', 'Samples', 'Beats', 'Sound FX', 'Stems', 'Presets'],
  },
  {
    slug: 'ProgramPlaza',
    name: 'ProgramPlaza',
    primaryDomain: 'programplaza.com',
    domains: ['programplaza.com', 'www.programplaza.com', 'programplaza.localhost', 'program.localhost'],
    hostHints: ['programplaza'],
    seoTitle: 'ProgramPlaza - Quality Custom Code',
    seoDescription: 'Code, developer components, templates, plugins, scripts, and APIs.',
    ...buildBrandAssets('ProgramPlaza'),
    theme: programPlazaTheme,
    settings: buildSettings({
      eyebrow: 'Quality Custom Code',
      title: 'ProgramPlaza',
      description: 'Explore code snippets, components, templates, plugins, scripts, APIs, and boilerplates built for developers.',
      trustBadges: ['Code + components', 'Plugins + APIs', 'Boilerplates', 'Developer-first taxonomy'],
    }),
    categories: ['Code Snippets', 'Components', 'Templates', 'Plugins', 'Scripts', 'APIs', 'Boilerplates'],
  },
  {
    slug: 'FileFoyer',
    name: 'FileFoyer',
    primaryDomain: 'filefoyer.com',
    domains: ['filefoyer.com', 'www.filefoyer.com', 'filefoyer.localhost', 'file.localhost'],
    hostHints: ['filefoyer'],
    seoTitle: 'FileFoyer - Documents Done Right',
    seoDescription: 'Documents, spreadsheets, presentations, forms, checklists, and eBooks.',
    ...buildBrandAssets('FileFoyer'),
    theme: fileFoyerTheme,
    settings: buildSettings({
      eyebrow: 'Documents Done Right',
      title: 'FileFoyer',
      description: 'Find documents, spreadsheets, presentations, templates, forms, checklists, and eBooks for teams and creators.',
      trustBadges: ['Docs + spreadsheets', 'Slides + forms', 'Templates + eBooks', 'Business-ready assets'],
    }),
    categories: ['Documents', 'Spreadsheets', 'Presentations', 'Forms', 'Checklists', 'Templates', 'eBooks'],
  },
]

const SITE_BRAND_PRESET_BY_SLUG = new Map(SITE_BRAND_PRESETS.map((preset) => [preset.slug.toLowerCase(), preset]))

export type SiteBrandable = {
  slug: string
  name?: string | null
  domain?: string | null
  logoUrl?: string | null
  faviconUrl?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  theme?: unknown
  settings?: unknown
  [key: string]: unknown
}

export function getSitePresetBySlug(slug: string | null | undefined) {
  const normalized = String(slug || '').trim().toLowerCase()
  if (!normalized) return null
  return SITE_BRAND_PRESET_BY_SLUG.get(normalized) || null
}

export function resolveSitePresetByHost(host: string | null | undefined) {
  const normalized = normalizeSiteHost(host)
  if (!normalized) return null

  for (const preset of SITE_BRAND_PRESETS) {
    if (preset.domains.includes(normalized)) return preset
  }

  for (const preset of SITE_BRAND_PRESETS) {
    if (preset.hostHints.some((hint) => normalized.includes(hint))) return preset
  }

  return null
}

export function applySiteBranding<T extends SiteBrandable>(site: T, options?: { host?: string | null; preset?: SiteBrandPreset | null }) {
  const preset = options?.preset || getSitePresetBySlug(site.slug) || resolveSitePresetByHost(options?.host)
  if (!preset) return site

  const domain = typeof site.domain === 'string' && site.domain.trim() ? site.domain.trim() : preset.primaryDomain
  const logoUrl = typeof site.logoUrl === 'string' && site.logoUrl.trim() ? site.logoUrl : preset.logoUrl
  const faviconUrl = typeof site.faviconUrl === 'string' && site.faviconUrl.trim() ? site.faviconUrl : preset.faviconUrl
  const seoTitle = typeof site.seoTitle === 'string' && site.seoTitle.trim() ? site.seoTitle : preset.seoTitle
  const seoDescription = typeof site.seoDescription === 'string' && site.seoDescription.trim() ? site.seoDescription : preset.seoDescription

  return {
    ...site,
    name: site.name || preset.name,
    domain,
    logoUrl,
    faviconUrl,
    seoTitle,
    seoDescription,
    theme: mergeJsonObjects(preset.theme, site.theme),
    settings: mergeJsonObjects(preset.settings, site.settings),
  } as T
}

export function getSeedSiteConfigs() {
  return SITE_BRAND_PRESETS.map((preset) => ({
    slug: preset.slug,
    name: preset.name,
    domain: preset.primaryDomain,
    logoUrl: preset.logoUrl,
    faviconUrl: preset.faviconUrl,
    seoTitle: preset.seoTitle,
    seoDescription: preset.seoDescription,
    theme: preset.theme,
    settings: preset.settings,
    categories: [...preset.categories],
  }))
}
