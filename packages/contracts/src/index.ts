import { z } from "zod";

export const storefrontKeys = [
  "createcanyon",
  "graphicgrounds",
  "melodymerchant",
  "filefoyer",
  "programplaza",
] as const;
export const storefrontKeySchema = z.enum(storefrontKeys);
export type StorefrontKey = z.infer<typeof storefrontKeySchema>;

export const assetTypes = [
  "PHOTO",
  "ILLUSTRATION",
  "VECTOR",
  "DESIGN_TEMPLATE",
  "FONT",
  "THREE_D",
  "MUSIC",
  "SOUND_EFFECT",
  "AUDIO_LOOP",
  "DOCUMENT_TEMPLATE",
  "PRESENTATION_TEMPLATE",
  "SPREADSHEET_TEMPLATE",
  "PRINTABLE",
  "CODE",
  "PLUGIN",
  "THEME",
  "INTEGRATION",
  "DEVELOPER_TOOL",
] as const;
export const assetTypeSchema = z.enum(assetTypes);
export type AssetType = z.infer<typeof assetTypeSchema>;

export const itemStatuses = [
  "DRAFT",
  "UPLOADED",
  "SCANNING",
  "PROCESSING",
  "AWAITING_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "PUBLISHED",
  "SUSPENDED",
  "RETIRED",
] as const;
export const itemStatusSchema = z.enum(itemStatuses);
export type ItemStatus = z.infer<typeof itemStatusSchema>;

export const currencySchema = z.string().regex(/^[A-Z]{3}$/);
export const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: currencySchema,
});

export const aiDisclosureSchema = z.enum(["NONE", "ASSISTED", "GENERATED"]);

export const createItemSchema = z
  .object({
    sellerOrganisationId: z.string().uuid(),
    assetType: assetTypeSchema,
    originChannelKey: storefrontKeySchema,
    channelKeys: z.array(storefrontKeySchema).min(1).max(storefrontKeys.length),
    title: z.string().trim().min(3).max(180),
    description: z.string().trim().min(20).max(30_000),
    tags: z.array(z.string().trim().min(2).max(40)).max(50).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
    aiDisclosure: aiDisclosureSchema.default("NONE"),
    basePrice: moneySchema,
  })
  .superRefine((input, context) => {
    if (!input.channelKeys.includes(input.originChannelKey)) {
      context.addIssue({ code: "custom", path: ["channelKeys"], message: "Origin channel must be selected" });
    }
    if (new Set(input.channelKeys).size !== input.channelKeys.length) {
      context.addIssue({ code: "custom", path: ["channelKeys"], message: "Channels must be unique" });
    }
  });
export type CreateItemInput = z.infer<typeof createItemSchema>;

export const updateListingSchema = z.object({
  title: z.string().trim().min(3).max(180).optional(),
  description: z.string().trim().min(20).max(30_000).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(2).max(40)).max(50).optional(),
  enabled: z.boolean().optional(),
  primary: z.boolean().optional(),
  seoTitle: z.string().trim().max(65).nullable().optional(),
  seoDescription: z.string().trim().max(170).nullable().optional(),
});
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const publicCatalogQuerySchema = z.object({
  channel: storefrontKeySchema.default("createcanyon"),
  q: z.string().trim().max(200).optional(),
  assetType: assetTypeSchema.optional(),
  category: z.string().trim().max(120).optional(),
  sort: z.enum(["relevance", "newest", "price_asc", "price_desc", "rating", "sales"]).default("relevance"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type PublicCatalogQuery = z.infer<typeof publicCatalogQuerySchema>;

export const uploadFileRoleSchema = z.enum(["ORIGINAL", "PREVIEW_SOURCE", "DOCUMENTATION", "RELEASE", "LICENSE"]);
export const createUploadSessionSchema = z.object({
  sellerOrganisationId: z.string().uuid(),
  itemVersionId: z.string().uuid(),
  files: z.array(z.object({
    clientFileId: z.string().uuid(),
    role: uploadFileRoleSchema,
    filename: z.string().min(1).max(255),
    contentType: z.string().min(3).max(255),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  })).min(1).max(500),
});
export type CreateUploadSessionInput = z.infer<typeof createUploadSessionSchema>;

export const finalizeUploadSchema = z.object({
  files: z.array(z.object({ clientFileId: z.string().uuid(), etag: z.string().min(1).max(255).optional() })).min(1),
});

export const addCartLineSchema = z.object({
  listingId: z.string().uuid(),
  licenseVariantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100).default(1),
});

export const checkoutSchema = z.object({
  cartId: z.string().uuid(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const moderationDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REQUEST_CHANGES", "SUSPEND"]),
  reasonCode: z.string().trim().min(2).max(80),
  notes: z.string().trim().min(5).max(10_000),
});

export const sellerCreateSchema = z.object({
  legalName: z.string().trim().min(2).max(255),
  displayName: z.string().trim().min(2).max(120),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  businessType: z.enum(["individual", "company", "non_profit"]),
  description: z.string().trim().max(5_000).optional(),
  websiteUrl: z.string().url().optional(),
});
