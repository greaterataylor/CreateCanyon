import { z } from 'zod'

const slugPattern = /^[a-z0-9-]+$/

export const signUpSchema = z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(8) })
export const signInSchema = z.object({ email: z.string().email(), password: z.string().min(1) })

export const categorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(slugPattern),
  description: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.coerce.boolean().default(true),
  icon: z.string().optional().nullable(),
  bannerUrl: z.string().optional().nullable(),
  metadataSchema: z.string().optional().nullable(),
  allowedPreviewTypes: z.string().optional().nullable(),
  allowedFileTypes: z.string().optional().nullable(),
  allowedLicenseTypes: z.string().optional().nullable(),
  defaultLicenseKey: z.string().optional().nullable(),
  taxCode: z.string().optional().nullable(),
  taxBehavior: z.enum(['exclusive', 'inclusive']).optional().nullable(),
  featured: z.coerce.boolean().default(false),
})

export const categoryGroupSchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(slugPattern),
  sortOrder: z.coerce.number().int().min(0).default(0),
})

export const categoryFieldTemplateSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.string().min(1),
  required: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
  options: z.string().optional().nullable(),
})

export const categoryRuleSchema = z.object({
  categoryId: z.string().min(1),
  key: z.string().min(1),
  value: z.string().optional().nullable(),
})

export const licenseTemplateSchema = z.object({
  key: z.string().regex(slugPattern),
  name: z.string().min(1),
  standardLabel: z.string().min(1),
  standardText: z.string().min(1),
  extendedLabel: z.string().min(1),
  extendedText: z.string().min(1),
  extendedMultiplier: z.coerce.number().positive().min(1),
  isDefault: z.coerce.boolean().default(false),
})

export const supportCaseSchema = z.object({
  type: z.enum(['refund', 'dispute', 'takedown']),
  assetId: z.string().min(1),
  orderId: z.string().optional().nullable(),
  message: z.string().min(10),
})

export const supportCaseUpdateSchema = z.object({
  status: z.enum(['open', 'in_review', 'resolved', 'rejected', 'counter_notice_received', 'released']),
  resolutionNotes: z.string().optional().nullable(),
  actionMode: z.enum(['', 'refund', 'partial_refund', 'freeze_downloads', 'reinstate', 'takedown', 'dispute_hold', 'dispute_release', 'dispute_lost']).optional().nullable(),
  amountCents: z.preprocess(
    (value) => value === '' || value === null || value === undefined ? undefined : Number(value),
    z.number().int().positive().optional(),
  ),
})

export const uploadPresignSchema = z.object({
  purpose: z.enum(['preview', 'download']),
  contentType: z.string().min(1),
  filename: z.string().min(1),
  sizeBytes: z.coerce.number().int().positive().max(2147483647),
  categoryId: z.string().optional().nullable(),
  uploadGroup: z.string().optional().nullable(),
})

export const assetCreateSchema = z.object({
  title: z.string().min(1),
  slug: z.string().regex(slugPattern).optional(),
  description: z.string().min(1),
  shortDescription: z.string().optional().nullable(),
  priceCents: z.coerce.number().int().min(50),
  currency: z.string().min(3).max(8).default('USD'),
  categoryId: z.string().min(1),
  kind: z.enum(['IMAGE', 'GRAPHIC', 'AUDIO', 'VIDEO', 'FONT', 'CODE', 'DOCUMENT', 'TEMPLATE', 'BUNDLE', 'OTHER']).default('OTHER'),
  previewType: z.enum(['IMAGE', 'AUDIO', 'VIDEO', 'CODE', 'FILE', 'PDF', 'FONT']),
  previewUpload: z.object({ storageKey: z.string(), filename: z.string(), mimeType: z.string(), sizeBytes: z.number().int().positive(), bucket: z.string() }).optional(),
  downloadUpload: z.object({ storageKey: z.string(), filename: z.string(), mimeType: z.string(), sizeBytes: z.number().int().positive(), bucket: z.string() }),
  metadata: z.any().optional(),
  tags: z.array(z.string()).default([]),
  licenseTemplateKey: z.string().optional().nullable(),
  taxCode: z.string().optional().nullable(),
  taxBehavior: z.enum(['exclusive', 'inclusive']).optional().nullable(),
  standardLicenseLabel: z.string().optional().nullable(),
  extendedLicenseLabel: z.string().optional().nullable(),
  standardLicenseText: z.string().optional().nullable(),
  extendedLicenseText: z.string().optional().nullable(),
  extendedPriceCents: z.coerce.number().int().min(50).optional().nullable(),
  licenseOptions: z.array(z.object({
    slug: z.string().regex(slugPattern),
    name: z.string().min(1),
    description: z.string().optional().nullable(),
    licenseText: z.string().optional().nullable(),
    priceCents: z.coerce.number().int().min(50),
    sortOrder: z.coerce.number().int().min(0).optional().nullable(),
    enabled: z.coerce.boolean().optional().nullable(),
  })).default([]),
})

export const assetVersionSchema = z.object({
  versionLabel: z.string().min(1),
  changelog: z.string().optional().nullable(),
  upload: z.object({ storageKey: z.string(), filename: z.string(), mimeType: z.string(), sizeBytes: z.number().int().positive(), bucket: z.string() }),
})

export const vendorUpdateSchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']), moderationNotes: z.string().optional().nullable() })

export const vendorStoreSchema = z.object({
  displayName: z.string().min(1),
  bio: z.string().optional().nullable(),
  storefrontName: z.string().optional().nullable(),
  storefrontSlug: z.string().regex(slugPattern),
  headline: z.string().optional().nullable(),
  payoutEmail: z.string().email().optional().nullable().or(z.literal('')),
  legalName: z.string().optional().nullable(),
  taxCountry: z.string().optional().nullable(),
})

export const assetStatusSchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED', 'DRAFT']), rejectionReason: z.string().optional().nullable() })

export const siteSettingsSchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  seoTitle: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  theme: z.string().optional().nullable(),
  settings: z.string().optional().nullable(),
})

export const siteNavigationItemSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isVisible: z.coerce.boolean().default(true),
})
