type ThemeObject = Record<string, any>

function asObject(value: unknown): ThemeObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as ThemeObject
  return {}
}

const brandKeys = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']

export function getThemeVariables(theme: unknown): Record<string, string> {
  const value = asObject(theme)
  const brand = asObject(value.brand)
  const colors = asObject(value.colors)
  const vars: Record<string, string> = {}

  for (const key of brandKeys) {
    const maybe = brand[key] || colors[`brand${key}`] || colors[`brand-${key}`]
    if (typeof maybe === 'string' && maybe.trim()) vars[`--color-brand-${key}`] = maybe.trim()
  }

  if (typeof value.backgroundColor === 'string' && value.backgroundColor.trim()) vars['--site-background-color'] = value.backgroundColor.trim()
  if (typeof value.textColor === 'string' && value.textColor.trim()) vars['--site-text-color'] = value.textColor.trim()
  return vars
}

export function getThemeColor(theme: unknown) {
  const value = asObject(theme)
  const brand = asObject(value.brand)
  const colors = asObject(value.colors)
  const candidates = [brand['500'], colors.brand500, colors['brand-500'], brand['600'], colors.brand600, colors['brand-600']]
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim() || null
}
