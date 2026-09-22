import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const userStatusEnum = pgEnum("user_status", ["ACTIVE", "LOCKED", "SUSPENDED", "DELETED"]);
export const sellerStatusEnum = pgEnum("seller_status", ["DRAFT", "PENDING_VERIFICATION", "ACTIVE", "RESTRICTED", "SUSPENDED", "CLOSED"]);
export const sellerMembershipRoleEnum = pgEnum("seller_membership_role", ["OWNER", "MANAGER", "UPLOADER", "FINANCE", "SUPPORT"]);
export const storefrontKeyEnum = pgEnum("storefront_key", ["createcanyon", "graphicgrounds", "melodymerchant", "filefoyer", "programplaza"]);
export const assetTypeEnum = pgEnum("asset_type", ["PHOTO", "ILLUSTRATION", "VECTOR", "DESIGN_TEMPLATE", "FONT", "THREE_D", "MUSIC", "SOUND_EFFECT", "AUDIO_LOOP", "DOCUMENT_TEMPLATE", "PRESENTATION_TEMPLATE", "SPREADSHEET_TEMPLATE", "PRINTABLE", "CODE", "PLUGIN", "THEME", "INTEGRATION", "DEVELOPER_TOOL"]);
export const itemStatusEnum = pgEnum("item_status", ["DRAFT", "UPLOADED", "SCANNING", "PROCESSING", "AWAITING_REVIEW", "CHANGES_REQUESTED", "APPROVED", "PUBLISHED", "SUSPENDED", "RETIRED"]);
export const listingStatusEnum = pgEnum("listing_status", ["DRAFT", "PENDING", "PUBLISHED", "HIDDEN", "SUSPENDED", "RETIRED"]);
export const aiDisclosureEnum = pgEnum("ai_disclosure", ["NONE", "ASSISTED", "GENERATED"]);
export const fileRoleEnum = pgEnum("file_role", ["ORIGINAL", "PREVIEW_SOURCE", "PREVIEW", "DOCUMENTATION", "RELEASE", "LICENSE", "MANIFEST"]);
export const fileStateEnum = pgEnum("file_state", ["PENDING", "UPLOADED", "QUARANTINED", "SCANNING", "PROCESSING", "READY", "INFECTED", "REJECTED", "DELETED"]);
export const uploadStatusEnum = pgEnum("upload_status", ["CREATED", "UPLOADING", "FINALIZED", "EXPIRED", "CANCELLED"]);
export const moderationStatusEnum = pgEnum("moderation_status", ["OPEN", "IN_REVIEW", "APPROVED", "CHANGES_REQUESTED", "SUSPENDED", "CLOSED"]);
export const moderationDecisionEnum = pgEnum("moderation_decision", ["APPROVE", "REQUEST_CHANGES", "SUSPEND", "REOPEN"]);
export const licenseKindEnum = pgEnum("license_kind", ["PERSONAL", "STANDARD_COMMERCIAL", "EXTENDED_COMMERCIAL", "EDITORIAL", "TEAM", "MUSIC_ONLINE", "MUSIC_BROADCAST", "FONT_DESKTOP", "FONT_WEB", "FONT_APP", "CODE_SINGLE", "CODE_AGENCY", "CODE_SAAS"]);
export const cartStatusEnum = pgEnum("cart_status", ["ACTIVE", "CHECKOUT_PENDING", "CONVERTED", "ABANDONED", "EXPIRED"]);
export const orderStatusEnum = pgEnum("order_status", ["PENDING_PAYMENT", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "CHARGEBACK", "CANCELLED"]);
export const paymentStatusEnum = pgEnum("payment_status", ["CREATED", "REQUIRES_ACTION", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED", "REFUNDED", "DISPUTED"]);
export const entitlementStatusEnum = pgEnum("entitlement_status", ["ACTIVE", "SUSPENDED", "REVOKED", "EXPIRED"]);
export const ledgerAccountTypeEnum = pgEnum("ledger_account_type", ["ASSET", "LIABILITY", "REVENUE", "EXPENSE", "EQUITY"]);
export const journalStatusEnum = pgEnum("journal_status", ["POSTED", "REVERSED"]);
export const transferStatusEnum = pgEnum("transfer_status", ["PENDING_RESERVE", "ELIGIBLE", "SUBMITTED", "PAID", "FAILED", "REVERSED", "HELD"]);
export const payoutStatusEnum = pgEnum("payout_status", ["PENDING", "IN_TRANSIT", "PAID", "FAILED", "CANCELLED"]);
export const reviewStatusEnum = pgEnum("review_status", ["PENDING", "PUBLISHED", "HIDDEN", "REMOVED"]);
export const rightsDocumentTypeEnum = pgEnum("rights_document_type", ["MODEL_RELEASE", "PROPERTY_RELEASE", "OWNERSHIP_EVIDENCE", "THIRD_PARTY_LICENSE", "OTHER"]);
export const rightsDocumentStatusEnum = pgEnum("rights_document_status", ["PENDING", "VERIFIED", "REJECTED", "EXPIRED"]);
export const copyrightStatusEnum = pgEnum("copyright_status", ["OPEN", "VALIDATING", "CONTENT_DISABLED", "SELLER_RESPONSE", "COUNTER_NOTICE", "RESTORED", "UPHELD", "CLOSED"]);
export const supportStatusEnum = pgEnum("support_status", ["OPEN", "WAITING_CUSTOMER", "WAITING_SELLER", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
export const actorTypeEnum = pgEnum("actor_type", ["USER", "ADMIN", "SYSTEM", "WEBHOOK"]);

export const users = pgTable("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  oidcSubject: varchar("oidc_subject", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 320 }),
  displayName: varchar("display_name", { length: 255 }),
  status: userStatusEnum("status").notNull().default("ACTIVE"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  locale: varchar("locale", { length: 16 }).notNull().default("en-AU"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [uniqueIndex("app_user_email_unique").on(sql`lower(${table.email})`), index("app_user_status_idx").on(table.status)]);

export const sellerOrganisations = pgTable("seller_organisation", {
  id: uuid("id").primaryKey().defaultRandom(),
  legalName: varchar("legal_name", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 140 }).notNull().unique(),
  status: sellerStatusEnum("status").notNull().default("DRAFT"),
  countryCode: varchar("country_code", { length: 2 }).notNull(),
  businessType: varchar("business_type", { length: 32 }).notNull(),
  description: text("description"),
  websiteUrl: text("website_url"),
  riskLevel: integer("risk_level").notNull().default(0),
  payoutHoldUntil: timestamp("payout_hold_until", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [index("seller_status_idx").on(table.status), index("seller_country_idx").on(table.countryCode)]);

export const sellerMemberships = pgTable("seller_membership", {
  sellerOrganisationId: uuid("seller_organisation_id").notNull().references(() => sellerOrganisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: sellerMembershipRoleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.sellerOrganisationId, table.userId] }), index("seller_membership_user_idx").on(table.userId)]);

export const paymentAccounts = pgTable("payment_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerOrganisationId: uuid("seller_organisation_id").notNull().references(() => sellerOrganisations.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull().default("stripe"),
  providerAccountId: varchar("provider_account_id", { length: 255 }).notNull().unique(),
  chargesEnabled: boolean("charges_enabled").notNull().default(false),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  detailsSubmitted: boolean("details_submitted").notNull().default(false),
  requirements: jsonb("requirements").$type<Record<string, unknown>>().notNull().default({}),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("payment_account_seller_provider_unique").on(table.sellerOrganisationId, table.provider), index("payment_account_payout_idx").on(table.payoutsEnabled)]);

export const storefronts = pgTable("storefront", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: storefrontKeyEnum("key").notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  hostname: varchar("hostname", { length: 255 }).notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [index("storefront_enabled_idx").on(table.enabled)]);

export const categories = pgTable("category", {
  id: uuid("id").primaryKey().defaultRandom(),
  storefrontId: uuid("storefront_id").notNull().references(() => storefronts.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "set null" }),
  slug: varchar("slug", { length: 140 }).notNull(),
  name: varchar("name", { length: 140 }).notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [uniqueIndex("category_storefront_slug_unique").on(table.storefrontId, table.slug), index("category_parent_idx").on(table.parentId)]);

export const metadataSchemas = pgTable("metadata_schema", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetType: assetTypeEnum("asset_type").notNull(),
  storefrontId: uuid("storefront_id").references(() => storefronts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  schema: jsonb("schema").$type<Record<string, unknown>>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("metadata_schema_unique").on(table.assetType, table.storefrontId, table.version)]);

export const catalogItems = pgTable("catalog_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerOrganisationId: uuid("seller_organisation_id").notNull().references(() => sellerOrganisations.id, { onDelete: "restrict" }),
  assetType: assetTypeEnum("asset_type").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description").notNull(),
  status: itemStatusEnum("status").notNull().default("DRAFT"),
  aiDisclosure: aiDisclosureEnum("ai_disclosure").notNull().default("NONE"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  originStorefrontId: uuid("origin_storefront_id").notNull().references(() => storefronts.id, { onDelete: "restrict" }),
  primaryStorefrontId: uuid("primary_storefront_id").notNull().references(() => storefronts.id, { onDelete: "restrict" }),
  currentVersionId: uuid("current_version_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("catalog_seller_idx").on(table.sellerOrganisationId), index("catalog_asset_status_idx").on(table.assetType, table.status), index("catalog_published_idx").on(table.publishedAt)]);

export const itemVersions = pgTable("item_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => catalogItems.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  versionLabel: varchar("version_label", { length: 64 }).notNull(),
  status: itemStatusEnum("status").notNull().default("DRAFT"),
  changelog: text("changelog"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("item_version_number_unique").on(table.itemId, table.versionNumber), index("item_version_status_idx").on(table.status)]);

export const channelListings = pgTable("channel_listing", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => catalogItems.id, { onDelete: "cascade" }),
  storefrontId: uuid("storefront_id").notNull().references(() => storefronts.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  slug: varchar("slug", { length: 180 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description").notNull(),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  status: listingStatusEnum("status").notNull().default("DRAFT"),
  enabled: boolean("enabled").notNull().default(true),
  isPrimary: boolean("is_primary").notNull().default(false),
  seoTitle: varchar("seo_title", { length: 65 }),
  seoDescription: varchar("seo_description", { length: 170 }),
  canonicalUrl: text("canonical_url"),
  featuredFileObjectId: uuid("featured_file_object_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("channel_listing_item_storefront_unique").on(table.itemId, table.storefrontId), uniqueIndex("channel_listing_storefront_slug_unique").on(table.storefrontId, table.slug), index("channel_listing_status_idx").on(table.storefrontId, table.status), index("channel_listing_category_idx").on(table.categoryId)]);

export const uploadSessions = pgTable("upload_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerOrganisationId: uuid("seller_organisation_id").notNull().references(() => sellerOrganisations.id, { onDelete: "cascade" }),
  itemVersionId: uuid("item_version_id").notNull().references(() => itemVersions.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: uploadStatusEnum("status").notNull().default("CREATED"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("upload_session_version_idx").on(table.itemVersionId), index("upload_session_expiry_idx").on(table.status, table.expiresAt)]);

export const fileObjects = pgTable("file_object", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemVersionId: uuid("item_version_id").notNull().references(() => itemVersions.id, { onDelete: "cascade" }),
  uploadSessionId: uuid("upload_session_id").references(() => uploadSessions.id, { onDelete: "set null" }),
  clientFileId: uuid("client_file_id"),
  role: fileRoleEnum("role").notNull(),
  state: fileStateEnum("state").notNull().default("PENDING"),
  bucket: varchar("bucket", { length: 255 }).notNull(),
  objectKey: text("object_key").notNull(),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  declaredMimeType: varchar("declared_mime_type", { length: 255 }).notNull(),
  detectedMimeType: varchar("detected_mime_type", { length: 255 }),
  byteSize: bigint("byte_size", { mode: "bigint" }).notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  etag: varchar("etag", { length: 255 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  scanResult: jsonb("scan_result").$type<Record<string, unknown>>(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("file_object_bucket_key_unique").on(table.bucket, table.objectKey), uniqueIndex("file_object_upload_client_unique").on(table.uploadSessionId, table.clientFileId), index("file_object_version_role_idx").on(table.itemVersionId, table.role), index("file_object_state_idx").on(table.state), check("file_object_size_positive", sql`${table.byteSize} > 0`)]);

export const licenseTemplates = pgTable("license_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: licenseKindEnum("kind").notNull(),
  name: varchar("name", { length: 140 }).notNull(),
  version: integer("version").notNull(),
  summary: text("summary").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (table) => [uniqueIndex("license_template_kind_version_unique").on(table.kind, table.version)]);

export const licenseVariants = pgTable("license_variant", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => catalogItems.id, { onDelete: "cascade" }),
  licenseTemplateId: uuid("license_template_id").notNull().references(() => licenseTemplates.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 140 }).notNull(),
  parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
}, (table) => [uniqueIndex("license_variant_item_template_unique").on(table.itemId, table.licenseTemplateId)]);

export const offers = pgTable("offer", {
  id: uuid("id").primaryKey().defaultRandom(),
  licenseVariantId: uuid("license_variant_id").notNull().references(() => licenseVariants.id, { onDelete: "cascade" }),
  storefrontId: uuid("storefront_id").references(() => storefronts.id, { onDelete: "cascade" }),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  active: boolean("active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("offer_variant_storefront_unique").on(table.licenseVariantId, table.storefrontId), check("offer_amount_nonnegative", sql`${table.amountMinor} >= 0`)]);

export const carts = pgTable("cart", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  status: cartStatusEnum("status").notNull().default("ACTIVE"),
  currency: varchar("currency", { length: 3 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  sourceStorefrontId: uuid("source_storefront_id").references(() => storefronts.id, { onDelete: "set null" }),
  ...timestamps,
}, (table) => [index("cart_user_status_idx").on(table.userId, table.status), index("cart_expiry_idx").on(table.expiresAt)]);

export const cartLines = pgTable("cart_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  cartId: uuid("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
  listingId: uuid("listing_id").notNull().references(() => channelListings.id, { onDelete: "restrict" }),
  licenseVariantId: uuid("license_variant_id").notNull().references(() => licenseVariants.id, { onDelete: "restrict" }),
  addedFromStorefrontId: uuid("added_from_storefront_id").notNull().references(() => storefronts.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull().default(1),
  unitPriceMinorSnapshot: bigint("unit_price_minor_snapshot", { mode: "bigint" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("cart_line_unique").on(table.cartId, table.listingId, table.licenseVariantId), check("cart_line_quantity_positive", sql`${table.quantity} > 0`)]);

export const orders = pgTable("customer_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNumber: varchar("order_number", { length: 40 }).notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  cartId: uuid("cart_id").references(() => carts.id, { onDelete: "set null" }),
  status: orderStatusEnum("status").notNull().default("PENDING_PAYMENT"),
  currency: varchar("currency", { length: 3 }).notNull(),
  subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(sql`0`),
  taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull().default(sql`0`),
  totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
  billingSnapshot: jsonb("billing_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("order_user_idx").on(table.userId, table.createdAt), index("order_status_idx").on(table.status)]);

export const orderLines = pgTable("order_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  canonicalItemId: uuid("canonical_item_id").notNull().references(() => catalogItems.id, { onDelete: "restrict" }),
  itemVersionId: uuid("item_version_id").notNull().references(() => itemVersions.id, { onDelete: "restrict" }),
  channelListingId: uuid("channel_listing_id").notNull().references(() => channelListings.id, { onDelete: "restrict" }),
  sellerOrganisationId: uuid("seller_organisation_id").notNull().references(() => sellerOrganisations.id, { onDelete: "restrict" }),
  licenseVariantId: uuid("license_variant_id").notNull().references(() => licenseVariants.id, { onDelete: "restrict" }),
  licenseTemplateId: uuid("license_template_id").notNull().references(() => licenseTemplates.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull(),
  discountMinor: bigint("discount_minor", { mode: "bigint" }).notNull().default(sql`0`),
  taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull().default(sql`0`),
  platformFeeMinor: bigint("platform_fee_minor", { mode: "bigint" }).notNull(),
  sellerEarningsMinor: bigint("seller_earnings_minor", { mode: "bigint" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  titleSnapshot: varchar("title_snapshot", { length: 180 }).notNull(),
  sellerNameSnapshot: varchar("seller_name_snapshot", { length: 120 }).notNull(),
  licenseNameSnapshot: varchar("license_name_snapshot", { length: 140 }).notNull(),
  licenseBodySnapshot: text("license_body_snapshot").notNull(),
  metadataSnapshot: jsonb("metadata_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("order_line_order_idx").on(table.orderId), index("order_line_seller_idx").on(table.sellerOrganisationId)]);

export const payments = pgTable("payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  provider: varchar("provider", { length: 32 }).notNull().default("stripe"),
  providerPaymentIntentId: varchar("provider_payment_intent_id", { length: 255 }).notNull().unique(),
  providerChargeId: varchar("provider_charge_id", { length: 255 }),
  status: paymentStatusEnum("status").notNull().default("CREATED"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  refundedMinor: bigint("refunded_minor", { mode: "bigint" }).notNull().default(sql`0`),
  currency: varchar("currency", { length: 3 }).notNull(),
  failureCode: varchar("failure_code", { length: 255 }),
  failureMessage: text("failure_message"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [index("payment_order_idx").on(table.orderId), index("payment_status_idx").on(table.status)]);

export const entitlements = pgTable("entitlement", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  orderLineId: uuid("order_line_id").notNull().references(() => orderLines.id, { onDelete: "restrict" }),
  itemId: uuid("item_id").notNull().references(() => catalogItems.id, { onDelete: "restrict" }),
  itemVersionId: uuid("item_version_id").notNull().references(() => itemVersions.id, { onDelete: "restrict" }),
  status: entitlementStatusEnum("status").notNull().default("ACTIVE"),
  updateAccessUntil: timestamp("update_access_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [uniqueIndex("entitlement_user_order_line_unique").on(table.userId, table.orderLineId), index("entitlement_user_idx").on(table.userId, table.status)]);

export const licenseCertificates = pgTable("license_certificate", {
  id: uuid("id").primaryKey().defaultRandom(),
  certificateNumber: varchar("certificate_number", { length: 64 }).notNull().unique(),
  entitlementId: uuid("entitlement_id").notNull().references(() => entitlements.id, { onDelete: "restrict" }),
  licenseTemplateVersion: integer("license_template_version").notNull(),
  licenseSnapshot: jsonb("license_snapshot").$type<Record<string, unknown>>().notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revocationReason: text("revocation_reason"),
  signature: text("signature"),
}, (table) => [uniqueIndex("license_certificate_entitlement_unique").on(table.entitlementId)]);

export const downloadEvents = pgTable("download_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  entitlementId: uuid("entitlement_id").notNull().references(() => entitlements.id, { onDelete: "restrict" }),
  fileObjectId: uuid("file_object_id").notNull().references(() => fileObjects.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("download_entitlement_idx").on(table.entitlementId), index("download_user_created_idx").on(table.userId, table.createdAt)]);

export const ledgerAccounts = pgTable("ledger_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  type: ledgerAccountTypeEnum("type").notNull(),
  sellerOrganisationId: uuid("seller_organisation_id").references(() => sellerOrganisations.id, { onDelete: "restrict" }),
  currency: varchar("currency", { length: 3 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("ledger_seller_idx").on(table.sellerOrganisationId)]);

export const journals = pgTable("journal", {
  id: uuid("id").primaryKey().defaultRandom(),
  referenceType: varchar("reference_type", { length: 80 }).notNull(),
  referenceId: uuid("reference_id").notNull(),
  description: text("description").notNull(),
  status: journalStatusEnum("status").notNull().default("POSTED"),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  reversalJournalId: uuid("reversal_journal_id").references((): AnyPgColumn => journals.id, { onDelete: "restrict" }),
}, (table) => [uniqueIndex("journal_reference_unique").on(table.referenceType, table.referenceId)]);

export const journalLines = pgTable("journal_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  journalId: uuid("journal_id").notNull().references(() => journals.id, { onDelete: "restrict" }),
  ledgerAccountId: uuid("ledger_account_id").notNull().references(() => ledgerAccounts.id, { onDelete: "restrict" }),
  debitMinor: bigint("debit_minor", { mode: "bigint" }).notNull().default(sql`0`),
  creditMinor: bigint("credit_minor", { mode: "bigint" }).notNull().default(sql`0`),
  currency: varchar("currency", { length: 3 }).notNull(),
  memo: text("memo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("journal_line_journal_idx").on(table.journalId), index("journal_line_account_idx").on(table.ledgerAccountId), check("journal_line_one_side", sql`(${table.debitMinor} > 0 AND ${table.creditMinor} = 0) OR (${table.creditMinor} > 0 AND ${table.debitMinor} = 0)`)]);

export const transfers = pgTable("seller_transfer", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerOrganisationId: uuid("seller_organisation_id").notNull().references(() => sellerOrganisations.id, { onDelete: "restrict" }),
  orderLineId: uuid("order_line_id").notNull().references(() => orderLines.id, { onDelete: "restrict" }),
  providerTransferId: varchar("provider_transfer_id", { length: 255 }),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  status: transferStatusEnum("status").notNull().default("PENDING_RESERVE"),
  eligibleAt: timestamp("eligible_at", { withTimezone: true }).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  failureMessage: text("failure_message"),
  ...timestamps,
}, (table) => [uniqueIndex("transfer_order_line_unique").on(table.orderLineId), index("transfer_eligibility_idx").on(table.status, table.eligibleAt), index("transfer_seller_idx").on(table.sellerOrganisationId)]);

export const payouts = pgTable("seller_payout", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerOrganisationId: uuid("seller_organisation_id").notNull().references(() => sellerOrganisations.id, { onDelete: "restrict" }),
  providerPayoutId: varchar("provider_payout_id", { length: 255 }).unique(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  status: payoutStatusEnum("status").notNull().default("PENDING"),
  expectedArrivalAt: timestamp("expected_arrival_at", { withTimezone: true }),
  failureMessage: text("failure_message"),
  ...timestamps,
}, (table) => [index("payout_seller_status_idx").on(table.sellerOrganisationId, table.status)]);

export const reviews = pgTable("review", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  orderLineId: uuid("order_line_id").notNull().references(() => orderLines.id, { onDelete: "restrict" }),
  itemId: uuid("item_id").notNull().references(() => catalogItems.id, { onDelete: "restrict" }),
  rating: integer("rating").notNull(),
  title: varchar("title", { length: 180 }),
  body: text("body"),
  status: reviewStatusEnum("status").notNull().default("PENDING"),
  sellerResponse: text("seller_response"),
  ...timestamps,
}, (table) => [uniqueIndex("review_user_order_line_unique").on(table.userId, table.orderLineId), index("review_item_status_idx").on(table.itemId, table.status), check("review_rating_range", sql`${table.rating} between 1 and 5`)]);

export const moderationCases = pgTable("moderation_case", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemVersionId: uuid("item_version_id").notNull().references(() => itemVersions.id, { onDelete: "cascade" }).unique(),
  assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  status: moderationStatusEnum("status").notNull().default("OPEN"),
  priority: integer("priority").notNull().default(50),
  riskSignals: jsonb("risk_signals").$type<Record<string, unknown>>().notNull().default({}),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("moderation_queue_idx").on(table.status, table.priority, table.openedAt), index("moderation_assignee_idx").on(table.assignedToUserId)]);

export const moderationEvents = pgTable("moderation_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  moderationCaseId: uuid("moderation_case_id").notNull().references(() => moderationCases.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  decision: moderationDecisionEnum("decision").notNull(),
  reasonCode: varchar("reason_code", { length: 80 }).notNull(),
  notes: text("notes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("moderation_event_case_idx").on(table.moderationCaseId, table.createdAt)]);

export const rightsDocuments = pgTable("rights_document", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerOrganisationId: uuid("seller_organisation_id").notNull().references(() => sellerOrganisations.id, { onDelete: "restrict" }),
  itemVersionId: uuid("item_version_id").references(() => itemVersions.id, { onDelete: "cascade" }),
  fileObjectId: uuid("file_object_id").notNull().references(() => fileObjects.id, { onDelete: "restrict" }),
  type: rightsDocumentTypeEnum("type").notNull(),
  status: rightsDocumentStatusEnum("status").notNull().default("PENDING"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("rights_item_idx").on(table.itemVersionId, table.status)]);

export const copyrightClaims = pgTable("copyright_claim", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => catalogItems.id, { onDelete: "restrict" }),
  claimantName: varchar("claimant_name", { length: 255 }).notNull(),
  claimantEmail: varchar("claimant_email", { length: 320 }).notNull(),
  status: copyrightStatusEnum("status").notNull().default("OPEN"),
  allegation: text("allegation").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  sellerResponse: text("seller_response"),
  counterNotice: text("counter_notice"),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("copyright_item_status_idx").on(table.itemId, table.status)]);

export const supportCases = pgTable("support_case", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  sellerOrganisationId: uuid("seller_organisation_id").references(() => sellerOrganisations.id, { onDelete: "set null" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  orderLineId: uuid("order_line_id").references(() => orderLines.id, { onDelete: "set null" }),
  status: supportStatusEnum("status").notNull().default("OPEN"),
  subject: varchar("subject", { length: 255 }).notNull(),
  body: text("body").notNull(),
  assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (table) => [index("support_status_idx").on(table.status, table.updatedAt)]);

export const auditEvents = pgTable("audit_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorType: actorTypeEnum("actor_type").notNull(),
  action: varchar("action", { length: 180 }).notNull(),
  resourceType: varchar("resource_type", { length: 120 }).notNull(),
  resourceId: varchar("resource_id", { length: 255 }).notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: text("user_agent"),
  requestId: varchar("request_id", { length: 255 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_resource_idx").on(table.resourceType, table.resourceId), index("audit_actor_idx").on(table.actorUserId, table.createdAt)]);

export const idempotencyKeys = pgTable("idempotency_key", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: varchar("scope", { length: 180 }).notNull(),
  key: varchar("key", { length: 255 }).notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("idempotency_scope_key_unique").on(table.scope, table.key), index("idempotency_expiry_idx").on(table.expiresAt)]);

export const outboxEvents = pgTable("outbox_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: varchar("event_type", { length: 180 }).notNull(),
  aggregateType: varchar("aggregate_type", { length: 120 }).notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(10),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: varchar("locked_by", { length: 255 }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("outbox_available_idx").on(table.processedAt, table.failedAt, table.availableAt), index("outbox_aggregate_idx").on(table.aggregateType, table.aggregateId)]);
