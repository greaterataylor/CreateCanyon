-- Baseline derived from the supplied Drizzle schema, plus marketplace extensions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'LOCKED', 'SUSPENDED', 'DELETED');
CREATE TYPE "seller_status" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSED');
CREATE TYPE "seller_membership_role" AS ENUM ('OWNER', 'MANAGER', 'UPLOADER', 'FINANCE', 'SUPPORT');
CREATE TYPE "storefront_key" AS ENUM ('createcanyon', 'graphicgrounds', 'melodymerchant', 'filefoyer', 'programplaza');
CREATE TYPE "asset_type" AS ENUM ('PHOTO', 'ILLUSTRATION', 'VECTOR', 'DESIGN_TEMPLATE', 'FONT', 'THREE_D', 'MUSIC', 'SOUND_EFFECT', 'AUDIO_LOOP', 'DOCUMENT_TEMPLATE', 'PRESENTATION_TEMPLATE', 'SPREADSHEET_TEMPLATE', 'PRINTABLE', 'CODE', 'PLUGIN', 'THEME', 'INTEGRATION', 'DEVELOPER_TOOL');
CREATE TYPE "item_status" AS ENUM ('DRAFT', 'UPLOADED', 'SCANNING', 'PROCESSING', 'AWAITING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'SUSPENDED', 'RETIRED');
CREATE TYPE "listing_status" AS ENUM ('DRAFT', 'PENDING', 'PUBLISHED', 'HIDDEN', 'SUSPENDED', 'RETIRED');
CREATE TYPE "ai_disclosure" AS ENUM ('NONE', 'ASSISTED', 'GENERATED');
CREATE TYPE "file_role" AS ENUM ('ORIGINAL', 'PREVIEW_SOURCE', 'PREVIEW', 'DOCUMENTATION', 'RELEASE', 'LICENSE', 'MANIFEST');
CREATE TYPE "file_state" AS ENUM ('PENDING', 'UPLOADED', 'QUARANTINED', 'SCANNING', 'PROCESSING', 'READY', 'INFECTED', 'REJECTED', 'DELETED');
CREATE TYPE "upload_status" AS ENUM ('CREATED', 'UPLOADING', 'FINALIZED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "moderation_status" AS ENUM ('OPEN', 'IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'SUSPENDED', 'CLOSED');
CREATE TYPE "moderation_decision" AS ENUM ('APPROVE', 'REQUEST_CHANGES', 'SUSPEND', 'REOPEN');
CREATE TYPE "license_kind" AS ENUM ('PERSONAL', 'STANDARD_COMMERCIAL', 'EXTENDED_COMMERCIAL', 'EDITORIAL', 'TEAM', 'MUSIC_ONLINE', 'MUSIC_BROADCAST', 'FONT_DESKTOP', 'FONT_WEB', 'FONT_APP', 'CODE_SINGLE', 'CODE_AGENCY', 'CODE_SAAS');
CREATE TYPE "cart_status" AS ENUM ('ACTIVE', 'CHECKOUT_PENDING', 'CONVERTED', 'ABANDONED', 'EXPIRED');
CREATE TYPE "order_status" AS ENUM ('PENDING_PAYMENT', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CHARGEBACK', 'CANCELLED');
CREATE TYPE "payment_status" AS ENUM ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'DISPUTED');
CREATE TYPE "entitlement_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED');
CREATE TYPE "ledger_account_type" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY');
CREATE TYPE "journal_status" AS ENUM ('POSTED', 'REVERSED');
CREATE TYPE "transfer_status" AS ENUM ('PENDING_RESERVE', 'ELIGIBLE', 'SUBMITTED', 'PAID', 'FAILED', 'REVERSED', 'HELD');
CREATE TYPE "payout_status" AS ENUM ('PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'CANCELLED');
CREATE TYPE "review_status" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN', 'REMOVED');
CREATE TYPE "rights_document_type" AS ENUM ('MODEL_RELEASE', 'PROPERTY_RELEASE', 'OWNERSHIP_EVIDENCE', 'THIRD_PARTY_LICENSE', 'OTHER');
CREATE TYPE "rights_document_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');
CREATE TYPE "copyright_status" AS ENUM ('OPEN', 'VALIDATING', 'CONTENT_DISABLED', 'SELLER_RESPONSE', 'COUNTER_NOTICE', 'RESTORED', 'UPHELD', 'CLOSED');
CREATE TYPE "support_status" AS ENUM ('OPEN', 'WAITING_CUSTOMER', 'WAITING_SELLER', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "actor_type" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'WEBHOOK');

CREATE TABLE "app_user" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "oidc_subject" varchar(255) NOT NULL UNIQUE,
  "email" varchar(320),
  "display_name" varchar(255),
  "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
  "last_login_at" timestamptz,
  "locale" varchar(16) NOT NULL DEFAULT 'en-AU',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "seller_organisation" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "legal_name" varchar(255) NOT NULL,
  "display_name" varchar(120) NOT NULL,
  "slug" varchar(140) NOT NULL UNIQUE,
  "status" "seller_status" NOT NULL DEFAULT 'DRAFT',
  "country_code" varchar(2) NOT NULL,
  "business_type" varchar(32) NOT NULL,
  "description" text,
  "website_url" text,
  "risk_level" integer NOT NULL DEFAULT 0,
  "payout_hold_until" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "seller_membership" (
  "seller_organisation_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" "seller_membership_role" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("seller_organisation_id", "user_id")
);

CREATE TABLE "payment_account" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_organisation_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL DEFAULT 'stripe',
  "provider_account_id" varchar(255) NOT NULL UNIQUE,
  "charges_enabled" boolean NOT NULL DEFAULT false,
  "payouts_enabled" boolean NOT NULL DEFAULT false,
  "details_submitted" boolean NOT NULL DEFAULT false,
  "requirements" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_synced_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "storefront" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" "storefront_key" NOT NULL UNIQUE,
  "name" varchar(120) NOT NULL,
  "hostname" varchar(255) NOT NULL UNIQUE,
  "enabled" boolean NOT NULL DEFAULT true,
  "configuration" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "category" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "storefront_id" uuid NOT NULL,
  "parent_id" uuid,
  "slug" varchar(140) NOT NULL,
  "name" varchar(140) NOT NULL,
  "description" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "enabled" boolean NOT NULL DEFAULT true,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "metadata_schema" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_type" "asset_type" NOT NULL,
  "storefront_id" uuid,
  "version" integer NOT NULL,
  "schema" jsonb NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "catalog_item" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_organisation_id" uuid NOT NULL,
  "asset_type" "asset_type" NOT NULL,
  "title" varchar(180) NOT NULL,
  "description" text NOT NULL,
  "status" "item_status" NOT NULL DEFAULT 'DRAFT',
  "ai_disclosure" "ai_disclosure" NOT NULL DEFAULT 'NONE',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "origin_storefront_id" uuid NOT NULL,
  "primary_storefront_id" uuid NOT NULL,
  "current_version_id" uuid,
  "published_at" timestamptz,
  "retired_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "item_version" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "version_label" varchar(64) NOT NULL,
  "status" "item_status" NOT NULL DEFAULT 'DRAFT',
  "changelog" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by_user_id" uuid,
  "submitted_at" timestamptz,
  "approved_at" timestamptz,
  "published_at" timestamptz,
  "retired_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "channel_listing" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" uuid NOT NULL,
  "storefront_id" uuid NOT NULL,
  "category_id" uuid,
  "slug" varchar(180) NOT NULL,
  "title" varchar(180) NOT NULL,
  "description" text NOT NULL,
  "tags" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "status" "listing_status" NOT NULL DEFAULT 'DRAFT',
  "enabled" boolean NOT NULL DEFAULT true,
  "is_primary" boolean NOT NULL DEFAULT false,
  "seo_title" varchar(65),
  "seo_description" varchar(170),
  "canonical_url" text,
  "featured_file_object_id" uuid,
  "published_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "upload_session" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_organisation_id" uuid NOT NULL,
  "item_version_id" uuid NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "status" "upload_status" NOT NULL DEFAULT 'CREATED',
  "expires_at" timestamptz NOT NULL,
  "finalized_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "file_object" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_version_id" uuid NOT NULL,
  "upload_session_id" uuid,
  "client_file_id" uuid,
  "role" "file_role" NOT NULL,
  "state" "file_state" NOT NULL DEFAULT 'PENDING',
  "bucket" varchar(255) NOT NULL,
  "object_key" text NOT NULL,
  "original_filename" varchar(255) NOT NULL,
  "declared_mime_type" varchar(255) NOT NULL,
  "detected_mime_type" varchar(255),
  "byte_size" bigint NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "etag" varchar(255),
  "storage_version_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "scan_result" jsonb,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "file_object_size_positive" CHECK ("byte_size" > 0)
);

CREATE TABLE "license_template" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" "license_kind" NOT NULL,
  "name" varchar(140) NOT NULL,
  "version" integer NOT NULL,
  "summary" text NOT NULL,
  "body_markdown" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "retired_at" timestamptz
);

CREATE TABLE "license_variant" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" uuid NOT NULL,
  "license_template_id" uuid NOT NULL,
  "name" varchar(140) NOT NULL,
  "parameters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "offer" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "license_variant_id" uuid NOT NULL,
  "storefront_id" uuid,
  "amount_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "starts_at" timestamptz,
  "ends_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "offer_amount_nonnegative" CHECK ("amount_minor" >= 0)
);

CREATE TABLE "cart" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "status" "cart_status" NOT NULL DEFAULT 'ACTIVE',
  "currency" varchar(3) NOT NULL,
  "expires_at" timestamptz,
  "source_storefront_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "cart_line" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "cart_id" uuid NOT NULL,
  "listing_id" uuid NOT NULL,
  "license_variant_id" uuid NOT NULL,
  "added_from_storefront_id" uuid NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "unit_price_minor_snapshot" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cart_line_quantity_positive" CHECK ("quantity" > 0)
);

CREATE TABLE "customer_order" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_number" varchar(40) NOT NULL UNIQUE,
  "user_id" uuid NOT NULL,
  "cart_id" uuid,
  "status" "order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "currency" varchar(3) NOT NULL,
  "subtotal_minor" bigint NOT NULL,
  "discount_minor" bigint NOT NULL DEFAULT 0,
  "tax_minor" bigint NOT NULL DEFAULT 0,
  "total_minor" bigint NOT NULL,
  "tax_calculation_id" text,
  "tax_transaction_id" text,
  "billing_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "paid_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "order_line" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL,
  "canonical_item_id" uuid NOT NULL,
  "item_version_id" uuid NOT NULL,
  "channel_listing_id" uuid NOT NULL,
  "seller_organisation_id" uuid NOT NULL,
  "license_variant_id" uuid NOT NULL,
  "license_template_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price_minor" bigint NOT NULL,
  "discount_minor" bigint NOT NULL DEFAULT 0,
  "tax_minor" bigint NOT NULL DEFAULT 0,
  "platform_fee_minor" bigint NOT NULL,
  "seller_earnings_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "title_snapshot" varchar(180) NOT NULL,
  "seller_name_snapshot" varchar(120) NOT NULL,
  "license_name_snapshot" varchar(140) NOT NULL,
  "license_body_snapshot" text NOT NULL,
  "metadata_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "payment" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL DEFAULT 'stripe',
  "provider_payment_intent_id" varchar(255) NOT NULL UNIQUE,
  "provider_charge_id" varchar(255),
  "status" "payment_status" NOT NULL DEFAULT 'CREATED',
  "amount_minor" bigint NOT NULL,
  "refunded_minor" bigint NOT NULL DEFAULT 0,
  "currency" varchar(3) NOT NULL,
  "failure_code" varchar(255),
  "failure_message" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "entitlement" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "order_line_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "item_version_id" uuid NOT NULL,
  "status" "entitlement_status" NOT NULL DEFAULT 'ACTIVE',
  "update_access_until" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz
);

CREATE TABLE "license_certificate" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "certificate_number" varchar(64) NOT NULL UNIQUE,
  "entitlement_id" uuid NOT NULL,
  "license_template_version" integer NOT NULL,
  "license_snapshot" jsonb NOT NULL,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "revocation_reason" text,
  "signature" text
);

CREATE TABLE "download_event" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "entitlement_id" uuid NOT NULL,
  "file_object_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "ip_address" varchar(64),
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "ledger_account" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(100) NOT NULL UNIQUE,
  "name" varchar(180) NOT NULL,
  "type" "ledger_account_type" NOT NULL,
  "seller_organisation_id" uuid,
  "currency" varchar(3) NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "journal" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference_type" varchar(80) NOT NULL,
  "reference_id" uuid NOT NULL,
  "description" text NOT NULL,
  "status" "journal_status" NOT NULL DEFAULT 'POSTED',
  "posted_at" timestamptz NOT NULL DEFAULT now(),
  "reversal_journal_id" uuid
);

CREATE TABLE "journal_line" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "journal_id" uuid NOT NULL,
  "ledger_account_id" uuid NOT NULL,
  "debit_minor" bigint NOT NULL DEFAULT 0,
  "credit_minor" bigint NOT NULL DEFAULT 0,
  "currency" varchar(3) NOT NULL,
  "memo" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "journal_line_one_side" CHECK (("debit_minor" > 0 AND "credit_minor" = 0) OR ("credit_minor" > 0 AND "debit_minor" = 0))
);

CREATE TABLE "seller_transfer" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_organisation_id" uuid NOT NULL,
  "order_line_id" uuid NOT NULL,
  "provider_transfer_id" varchar(255),
  "reversed_minor" bigint NOT NULL DEFAULT 0,
  "amount_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "status" "transfer_status" NOT NULL DEFAULT 'PENDING_RESERVE',
  "eligible_at" timestamptz NOT NULL,
  "submitted_at" timestamptz,
  "paid_at" timestamptz,
  "failure_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "seller_payout" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_organisation_id" uuid NOT NULL,
  "provider_payout_id" varchar(255) UNIQUE,
  "amount_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "status" "payout_status" NOT NULL DEFAULT 'PENDING',
  "expected_arrival_at" timestamptz,
  "failure_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "review" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "order_line_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "rating" integer NOT NULL,
  "title" varchar(180),
  "body" text,
  "status" "review_status" NOT NULL DEFAULT 'PENDING',
  "seller_response" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "review_rating_range" CHECK ("rating" between 1 and 5)
);

CREATE TABLE "moderation_case" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_version_id" uuid NOT NULL UNIQUE,
  "assigned_to_user_id" uuid,
  "status" "moderation_status" NOT NULL DEFAULT 'OPEN',
  "priority" integer NOT NULL DEFAULT 50,
  "risk_signals" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "moderation_event" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "moderation_case_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "decision" "moderation_decision" NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "notes" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "rights_document" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_organisation_id" uuid NOT NULL,
  "item_version_id" uuid,
  "file_object_id" uuid NOT NULL,
  "type" "rights_document_type" NOT NULL,
  "status" "rights_document_status" NOT NULL DEFAULT 'PENDING',
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "copyright_claim" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" uuid NOT NULL,
  "claimant_name" varchar(255) NOT NULL,
  "claimant_email" varchar(320) NOT NULL,
  "status" "copyright_status" NOT NULL DEFAULT 'OPEN',
  "allegation" text NOT NULL,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "seller_response" text,
  "counter_notice" text,
  "decided_by_user_id" uuid,
  "closed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "support_case" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "seller_organisation_id" uuid,
  "order_id" uuid,
  "order_line_id" uuid,
  "status" "support_status" NOT NULL DEFAULT 'OPEN',
  "subject" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "assigned_to_user_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "audit_event" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" uuid,
  "actor_type" "actor_type" NOT NULL,
  "sequence" bigint,
  "previous_hash" varchar(64),
  "record_hash" varchar(64),
  "action" varchar(180) NOT NULL,
  "resource_type" varchar(120) NOT NULL,
  "resource_id" varchar(255) NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "ip_address" varchar(64),
  "user_agent" text,
  "request_id" varchar(255),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "idempotency_key" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope" varchar(180) NOT NULL,
  "key" varchar(255) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "response_status" integer,
  "response_body" jsonb,
  "locked_until" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "outbox_event" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "dedupe_key" text UNIQUE,
  "event_type" varchar(180) NOT NULL,
  "aggregate_type" varchar(120) NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 10,
  "locked_at" timestamptz,
  "locked_by" varchar(255),
  "processed_at" timestamptz,
  "failed_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "channel_eligibility" (
  "storefront_id" uuid NOT NULL,
  "asset_type" "asset_type" NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  PRIMARY KEY ("storefront_id", "asset_type")
);

CREATE TABLE "seller_terms" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer NOT NULL UNIQUE,
  "body_markdown" text NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "effective_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "seller_terms_acceptance" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "seller_organisation_id" uuid NOT NULL,
  "terms_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "accepted_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "support_message" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL,
  "author_user_id" uuid NOT NULL,
  "body" text NOT NULL,
  "internal" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "notification" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "dedupe_key" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "href" text,
  "read_at" timestamptz,
  "email_sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "refund_request" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_line_id" uuid NOT NULL,
  "requested_by_user_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "provider_refund_id" text UNIQUE,
  "amount_minor" bigint NOT NULL,
  "seller_minor" bigint NOT NULL,
  "fee_minor" bigint NOT NULL,
  "tax_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'REQUESTED',
  "reason" text NOT NULL,
  "failure_message" text,
  "tax_reversal_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "refund_positive" CHECK ("amount_minor" > 0)
);

CREATE TABLE "transfer_reversal" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "transfer_id" uuid NOT NULL,
  "refund_id" uuid NOT NULL UNIQUE,
  "provider_reversal_id" text UNIQUE,
  "amount_minor" bigint NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'REQUESTED',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "payment_dispute" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider_dispute_id" text NOT NULL UNIQUE,
  "payment_id" uuid NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" varchar(3) NOT NULL,
  "status" varchar(48) NOT NULL,
  "funds_withdrawn" boolean NOT NULL DEFAULT false,
  "funds_reinstated" boolean NOT NULL DEFAULT false,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "webhook_event" (
  "provider_event_id" text NOT NULL PRIMARY KEY,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz
);

CREATE TABLE "scan_result" (
  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_object_id" uuid NOT NULL,
  "scanner" text NOT NULL,
  "status" text NOT NULL,
  "report" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "wishlist_item" (
  "user_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "item_id")
);
CREATE UNIQUE INDEX "app_user_email_unique" ON "app_user" (lower("email"));
CREATE INDEX "app_user_status_idx" ON "app_user" ("status");
CREATE INDEX "seller_status_idx" ON "seller_organisation" ("status");
CREATE INDEX "seller_country_idx" ON "seller_organisation" ("country_code");
ALTER TABLE "seller_membership" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE CASCADE;
ALTER TABLE "seller_membership" ADD FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE CASCADE;
CREATE INDEX "seller_membership_user_idx" ON "seller_membership" ("user_id");
ALTER TABLE "payment_account" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "payment_account_seller_provider_unique" ON "payment_account" ("seller_organisation_id", "provider");
CREATE INDEX "payment_account_payout_idx" ON "payment_account" ("payouts_enabled");
CREATE INDEX "storefront_enabled_idx" ON "storefront" ("enabled");
ALTER TABLE "category" ADD FOREIGN KEY ("storefront_id") REFERENCES "storefront" ("id") ON DELETE CASCADE;
ALTER TABLE "category" ADD FOREIGN KEY ("parent_id") REFERENCES "category" ("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "category_storefront_slug_unique" ON "category" ("storefront_id", "slug");
CREATE INDEX "category_parent_idx" ON "category" ("parent_id");
ALTER TABLE "metadata_schema" ADD FOREIGN KEY ("storefront_id") REFERENCES "storefront" ("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "metadata_schema_unique" ON "metadata_schema" ("asset_type", "storefront_id", "version");
ALTER TABLE "catalog_item" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE RESTRICT;
ALTER TABLE "catalog_item" ADD FOREIGN KEY ("origin_storefront_id") REFERENCES "storefront" ("id") ON DELETE RESTRICT;
ALTER TABLE "catalog_item" ADD FOREIGN KEY ("primary_storefront_id") REFERENCES "storefront" ("id") ON DELETE RESTRICT;
CREATE INDEX "catalog_seller_idx" ON "catalog_item" ("seller_organisation_id");
CREATE INDEX "catalog_asset_status_idx" ON "catalog_item" ("asset_type", "status");
CREATE INDEX "catalog_published_idx" ON "catalog_item" ("published_at");
ALTER TABLE "item_version" ADD FOREIGN KEY ("item_id") REFERENCES "catalog_item" ("id") ON DELETE CASCADE;
ALTER TABLE "item_version" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "app_user" ("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "item_version_number_unique" ON "item_version" ("item_id", "version_number");
CREATE INDEX "item_version_status_idx" ON "item_version" ("status");
ALTER TABLE "channel_listing" ADD FOREIGN KEY ("item_id") REFERENCES "catalog_item" ("id") ON DELETE CASCADE;
ALTER TABLE "channel_listing" ADD FOREIGN KEY ("storefront_id") REFERENCES "storefront" ("id") ON DELETE CASCADE;
ALTER TABLE "channel_listing" ADD FOREIGN KEY ("category_id") REFERENCES "category" ("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "channel_listing_item_storefront_unique" ON "channel_listing" ("item_id", "storefront_id");
CREATE UNIQUE INDEX "channel_listing_storefront_slug_unique" ON "channel_listing" ("storefront_id", "slug");
CREATE INDEX "channel_listing_status_idx" ON "channel_listing" ("storefront_id", "status");
CREATE INDEX "channel_listing_category_idx" ON "channel_listing" ("category_id");
ALTER TABLE "upload_session" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE CASCADE;
ALTER TABLE "upload_session" ADD FOREIGN KEY ("item_version_id") REFERENCES "item_version" ("id") ON DELETE CASCADE;
ALTER TABLE "upload_session" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "app_user" ("id") ON DELETE RESTRICT;
CREATE INDEX "upload_session_version_idx" ON "upload_session" ("item_version_id");
CREATE INDEX "upload_session_expiry_idx" ON "upload_session" ("status", "expires_at");
ALTER TABLE "file_object" ADD FOREIGN KEY ("item_version_id") REFERENCES "item_version" ("id") ON DELETE CASCADE;
ALTER TABLE "file_object" ADD FOREIGN KEY ("upload_session_id") REFERENCES "upload_session" ("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "file_object_bucket_key_unique" ON "file_object" ("bucket", "object_key");
CREATE UNIQUE INDEX "file_object_upload_client_unique" ON "file_object" ("upload_session_id", "client_file_id");
CREATE INDEX "file_object_version_role_idx" ON "file_object" ("item_version_id", "role");
CREATE INDEX "file_object_state_idx" ON "file_object" ("state");
CREATE UNIQUE INDEX "license_template_kind_version_unique" ON "license_template" ("kind", "version");
ALTER TABLE "license_variant" ADD FOREIGN KEY ("item_id") REFERENCES "catalog_item" ("id") ON DELETE CASCADE;
ALTER TABLE "license_variant" ADD FOREIGN KEY ("license_template_id") REFERENCES "license_template" ("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "license_variant_item_template_unique" ON "license_variant" ("item_id", "license_template_id");
ALTER TABLE "offer" ADD FOREIGN KEY ("license_variant_id") REFERENCES "license_variant" ("id") ON DELETE CASCADE;
ALTER TABLE "offer" ADD FOREIGN KEY ("storefront_id") REFERENCES "storefront" ("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "offer_variant_storefront_unique" ON "offer" ("license_variant_id", "storefront_id");
ALTER TABLE "cart" ADD FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE CASCADE;
ALTER TABLE "cart" ADD FOREIGN KEY ("source_storefront_id") REFERENCES "storefront" ("id") ON DELETE SET NULL;
CREATE INDEX "cart_user_status_idx" ON "cart" ("user_id", "status");
CREATE INDEX "cart_expiry_idx" ON "cart" ("expires_at");
ALTER TABLE "cart_line" ADD FOREIGN KEY ("cart_id") REFERENCES "cart" ("id") ON DELETE CASCADE;
ALTER TABLE "cart_line" ADD FOREIGN KEY ("listing_id") REFERENCES "channel_listing" ("id") ON DELETE RESTRICT;
ALTER TABLE "cart_line" ADD FOREIGN KEY ("license_variant_id") REFERENCES "license_variant" ("id") ON DELETE RESTRICT;
ALTER TABLE "cart_line" ADD FOREIGN KEY ("added_from_storefront_id") REFERENCES "storefront" ("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "cart_line_unique" ON "cart_line" ("cart_id", "listing_id", "license_variant_id");
ALTER TABLE "customer_order" ADD FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE RESTRICT;
ALTER TABLE "customer_order" ADD FOREIGN KEY ("cart_id") REFERENCES "cart" ("id") ON DELETE SET NULL;
CREATE INDEX "order_user_idx" ON "customer_order" ("user_id", "created_at");
CREATE INDEX "order_status_idx" ON "customer_order" ("status");
ALTER TABLE "order_line" ADD FOREIGN KEY ("order_id") REFERENCES "customer_order" ("id") ON DELETE CASCADE;
ALTER TABLE "order_line" ADD FOREIGN KEY ("canonical_item_id") REFERENCES "catalog_item" ("id") ON DELETE RESTRICT;
ALTER TABLE "order_line" ADD FOREIGN KEY ("item_version_id") REFERENCES "item_version" ("id") ON DELETE RESTRICT;
ALTER TABLE "order_line" ADD FOREIGN KEY ("channel_listing_id") REFERENCES "channel_listing" ("id") ON DELETE RESTRICT;
ALTER TABLE "order_line" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE RESTRICT;
ALTER TABLE "order_line" ADD FOREIGN KEY ("license_variant_id") REFERENCES "license_variant" ("id") ON DELETE RESTRICT;
ALTER TABLE "order_line" ADD FOREIGN KEY ("license_template_id") REFERENCES "license_template" ("id") ON DELETE RESTRICT;
CREATE INDEX "order_line_order_idx" ON "order_line" ("order_id");
CREATE INDEX "order_line_seller_idx" ON "order_line" ("seller_organisation_id");
ALTER TABLE "payment" ADD FOREIGN KEY ("order_id") REFERENCES "customer_order" ("id") ON DELETE RESTRICT;
CREATE INDEX "payment_order_idx" ON "payment" ("order_id");
CREATE INDEX "payment_status_idx" ON "payment" ("status");
ALTER TABLE "entitlement" ADD FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE RESTRICT;
ALTER TABLE "entitlement" ADD FOREIGN KEY ("order_line_id") REFERENCES "order_line" ("id") ON DELETE RESTRICT;
ALTER TABLE "entitlement" ADD FOREIGN KEY ("item_id") REFERENCES "catalog_item" ("id") ON DELETE RESTRICT;
ALTER TABLE "entitlement" ADD FOREIGN KEY ("item_version_id") REFERENCES "item_version" ("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "entitlement_user_order_line_unique" ON "entitlement" ("user_id", "order_line_id");
CREATE INDEX "entitlement_user_idx" ON "entitlement" ("user_id", "status");
ALTER TABLE "license_certificate" ADD FOREIGN KEY ("entitlement_id") REFERENCES "entitlement" ("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "license_certificate_entitlement_unique" ON "license_certificate" ("entitlement_id");
ALTER TABLE "download_event" ADD FOREIGN KEY ("entitlement_id") REFERENCES "entitlement" ("id") ON DELETE RESTRICT;
ALTER TABLE "download_event" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") ON DELETE RESTRICT;
ALTER TABLE "download_event" ADD FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE RESTRICT;
CREATE INDEX "download_entitlement_idx" ON "download_event" ("entitlement_id");
CREATE INDEX "download_user_created_idx" ON "download_event" ("user_id", "created_at");
ALTER TABLE "ledger_account" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE RESTRICT;
CREATE INDEX "ledger_seller_idx" ON "ledger_account" ("seller_organisation_id");
ALTER TABLE "journal" ADD FOREIGN KEY ("reversal_journal_id") REFERENCES "journal" ("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "journal_reference_unique" ON "journal" ("reference_type", "reference_id");
ALTER TABLE "journal_line" ADD FOREIGN KEY ("journal_id") REFERENCES "journal" ("id") ON DELETE RESTRICT;
ALTER TABLE "journal_line" ADD FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_account" ("id") ON DELETE RESTRICT;
CREATE INDEX "journal_line_journal_idx" ON "journal_line" ("journal_id");
CREATE INDEX "journal_line_account_idx" ON "journal_line" ("ledger_account_id");
ALTER TABLE "seller_transfer" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE RESTRICT;
ALTER TABLE "seller_transfer" ADD FOREIGN KEY ("order_line_id") REFERENCES "order_line" ("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "transfer_order_line_unique" ON "seller_transfer" ("order_line_id");
CREATE INDEX "transfer_eligibility_idx" ON "seller_transfer" ("status", "eligible_at");
CREATE INDEX "transfer_seller_idx" ON "seller_transfer" ("seller_organisation_id");
ALTER TABLE "seller_payout" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE RESTRICT;
CREATE INDEX "payout_seller_status_idx" ON "seller_payout" ("seller_organisation_id", "status");
ALTER TABLE "review" ADD FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE RESTRICT;
ALTER TABLE "review" ADD FOREIGN KEY ("order_line_id") REFERENCES "order_line" ("id") ON DELETE RESTRICT;
ALTER TABLE "review" ADD FOREIGN KEY ("item_id") REFERENCES "catalog_item" ("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "review_user_order_line_unique" ON "review" ("user_id", "order_line_id");
CREATE INDEX "review_item_status_idx" ON "review" ("item_id", "status");
ALTER TABLE "moderation_case" ADD FOREIGN KEY ("item_version_id") REFERENCES "item_version" ("id") ON DELETE CASCADE;
ALTER TABLE "moderation_case" ADD FOREIGN KEY ("assigned_to_user_id") REFERENCES "app_user" ("id") ON DELETE SET NULL;
CREATE INDEX "moderation_queue_idx" ON "moderation_case" ("status", "priority", "opened_at");
CREATE INDEX "moderation_assignee_idx" ON "moderation_case" ("assigned_to_user_id");
ALTER TABLE "moderation_event" ADD FOREIGN KEY ("moderation_case_id") REFERENCES "moderation_case" ("id") ON DELETE CASCADE;
ALTER TABLE "moderation_event" ADD FOREIGN KEY ("actor_user_id") REFERENCES "app_user" ("id") ON DELETE SET NULL;
CREATE INDEX "moderation_event_case_idx" ON "moderation_event" ("moderation_case_id", "created_at");
ALTER TABLE "rights_document" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE RESTRICT;
ALTER TABLE "rights_document" ADD FOREIGN KEY ("item_version_id") REFERENCES "item_version" ("id") ON DELETE CASCADE;
ALTER TABLE "rights_document" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") ON DELETE RESTRICT;
CREATE INDEX "rights_item_idx" ON "rights_document" ("item_version_id", "status");
ALTER TABLE "copyright_claim" ADD FOREIGN KEY ("item_id") REFERENCES "catalog_item" ("id") ON DELETE RESTRICT;
ALTER TABLE "copyright_claim" ADD FOREIGN KEY ("decided_by_user_id") REFERENCES "app_user" ("id") ON DELETE SET NULL;
CREATE INDEX "copyright_item_status_idx" ON "copyright_claim" ("item_id", "status");
ALTER TABLE "support_case" ADD FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE SET NULL;
ALTER TABLE "support_case" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE SET NULL;
ALTER TABLE "support_case" ADD FOREIGN KEY ("order_id") REFERENCES "customer_order" ("id") ON DELETE SET NULL;
ALTER TABLE "support_case" ADD FOREIGN KEY ("order_line_id") REFERENCES "order_line" ("id") ON DELETE SET NULL;
ALTER TABLE "support_case" ADD FOREIGN KEY ("assigned_to_user_id") REFERENCES "app_user" ("id") ON DELETE SET NULL;
CREATE INDEX "support_status_idx" ON "support_case" ("status", "updated_at");
ALTER TABLE "audit_event" ADD FOREIGN KEY ("actor_user_id") REFERENCES "app_user" ("id") ON DELETE SET NULL;
CREATE INDEX "audit_resource_idx" ON "audit_event" ("resource_type", "resource_id");
CREATE INDEX "audit_actor_idx" ON "audit_event" ("actor_user_id", "created_at");
CREATE UNIQUE INDEX "idempotency_scope_key_unique" ON "idempotency_key" ("scope", "key");
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_key" ("expires_at");
CREATE INDEX "outbox_available_idx" ON "outbox_event" ("processed_at", "failed_at", "available_at");
CREATE INDEX "outbox_aggregate_idx" ON "outbox_event" ("aggregate_type", "aggregate_id");
ALTER TABLE "channel_eligibility" ADD FOREIGN KEY ("storefront_id") REFERENCES "storefront" ("id") ON DELETE CASCADE;
ALTER TABLE "seller_terms_acceptance" ADD FOREIGN KEY ("seller_organisation_id") REFERENCES "seller_organisation" ("id") ON DELETE NO ACTION;
ALTER TABLE "seller_terms_acceptance" ADD FOREIGN KEY ("terms_id") REFERENCES "seller_terms" ("id") ON DELETE NO ACTION;
ALTER TABLE "seller_terms_acceptance" ADD FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE NO ACTION;
CREATE UNIQUE INDEX "seller_terms_acceptance_unique" ON "seller_terms_acceptance" ("seller_organisation_id", "terms_id");
ALTER TABLE "support_message" ADD FOREIGN KEY ("case_id") REFERENCES "support_case" ("id") ON DELETE NO ACTION;
ALTER TABLE "support_message" ADD FOREIGN KEY ("author_user_id") REFERENCES "app_user" ("id") ON DELETE NO ACTION;
CREATE INDEX "support_message_case_idx" ON "support_message" ("case_id", "created_at");
ALTER TABLE "notification" ADD FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE NO ACTION;
CREATE INDEX "notification_user_idx" ON "notification" ("user_id", "created_at");
ALTER TABLE "refund_request" ADD FOREIGN KEY ("order_line_id") REFERENCES "order_line" ("id") ON DELETE NO ACTION;
ALTER TABLE "refund_request" ADD FOREIGN KEY ("requested_by_user_id") REFERENCES "app_user" ("id") ON DELETE NO ACTION;
CREATE INDEX "refund_line_idx" ON "refund_request" ("order_line_id", "status");
ALTER TABLE "transfer_reversal" ADD FOREIGN KEY ("transfer_id") REFERENCES "seller_transfer" ("id") ON DELETE NO ACTION;
ALTER TABLE "transfer_reversal" ADD FOREIGN KEY ("refund_id") REFERENCES "refund_request" ("id") ON DELETE NO ACTION;
ALTER TABLE "payment_dispute" ADD FOREIGN KEY ("payment_id") REFERENCES "payment" ("id") ON DELETE NO ACTION;
ALTER TABLE "scan_result" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") ON DELETE NO ACTION;
CREATE UNIQUE INDEX "scan_file_scanner_unique" ON "scan_result" ("file_object_id", "scanner");
ALTER TABLE "wishlist_item" ADD FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE NO ACTION;
ALTER TABLE "wishlist_item" ADD FOREIGN KEY ("item_id") REFERENCES "catalog_item" ("id") ON DELETE NO ACTION;
