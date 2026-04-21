# CreateCanyon Marketplace Platform

A reusable Next.js + Prisma + Stripe + S3 marketplace platform for multi-brand digital asset stores such as:

- CreateCanyon
- GraphicGrounds
- MelodyMerchant
- ProgramPlaza
- FileFoyer

## Current implementation status

This build is no longer just a foundation-only marketplace shell. It now includes the core workflows needed for a production-oriented digital marketplace, with the biggest remaining gaps concentrated in **live infrastructure verification** rather than missing source code.

### Implemented platform capabilities

#### Marketplace, seller, and catalog foundations
- Multi-site resolution by hostname or fallback `SITE_SLUG`
- Built-in hostname presets and default branding for CreateCanyon, GraphicGrounds, MelodyMerchant, ProgramPlaza, and FileFoyer (including `www.` and `.localhost` aliases, plus `melodymercant.com` host matching)
- Global vendor profile + per-site vendor memberships and moderation
- Site-specific categories, groups, parent/child trees, metadata templates, and category rules
- Rich asset model with versions, files, previews, tags, structured metadata, and license options
- Seller storefront/profile management and buyer dashboards for purchases, orders, downloads, and collections
- Saved items / collections with signed-in server sync and guest fallback

#### Upload, versioning, and post-upload asset enforcement
- Secure upload presigning with authenticated, server-generated storage keys
- Category-aware validation during initial asset creation
- Category-aware validation during **replacement version uploads**
- Seller asset edit validation for preview type, price, metadata, and category/file-rule compatibility
- Seller edits and version changes requeue moderation where appropriate so approved assets do not silently drift out of policy

#### Compliance, support, and takedown enforcement
- Structured support cases for refund, dispute, and takedown requests with audit-log fallback
- Admin support queues for refunds, disputes, and takedowns
- Executable admin actions for:
  - full refund
  - partial refund
  - freeze downloads
  - takedown listing
  - reinstate listing
  - dispute reserve hold
  - dispute reserve release / seller win
  - dispute loss finalization
- Download endpoint enforcement for:
  - purchase entitlement
  - asset approval state
  - download freezes
  - seller membership approval
  - burst-abuse throttling with `429` API responses and browser redirects carrying a `rate-limited` state
- Counter-notice submission and support-history visibility on the seller side

#### Payments, ledger, refunds, disputes, and payouts
- Stripe Checkout order creation, purchase fulfillment, ledger posting, and seller transfer creation
- Refund execution through Stripe from support actions
- Refund webhook reconciliation that updates order state, writes seller refund ledger entries, and reverses seller transfers
- Dispute reserve / release handling for both Stripe webhooks and manual admin support actions
- Dispute-linked transfer reversals and transfer restoration when reserves are released
- Seller payout dashboard with visibility into:
  - available balance
  - accrued seller net
  - settled-to-bank payouts
  - refund adjustments
  - dispute reserves / releases
  - payout lifecycle activity
  - transfer / reversal / restore audit history
- Stripe payout lifecycle tracking for created, updated, paid, failed, and canceled payouts, including balance restore adjustments

#### Search and discovery
- Search page with:
  - keyword search over titles, descriptions, vendor names, category names, tags, and structured metadata
  - sort modes for best match, newest, price ascending, price descending, and popular
  - filters for category, kind, tag, vendor, and price range
  - facet chips for categories, vendors, tags, and kinds
- Search API support for vendor filtering and optional faceted metadata responses

#### Auth and API hardening
- `AUTH_SECRET` is required and no longer falls back to a development default
- Route auth wrappers convert auth failures into clean redirects / JSON responses instead of leaking uncaught errors
- Sign-in and sign-up throttling with audit-backed shared rate-limit tracking
- Sign-in/sign-up failure audit trails and lockout handling

#### Background worker pipeline
- Worker processors for:
  - virus scan
  - metadata extraction
  - image thumbnails
  - PDF thumbnails
  - audio waveforms
  - audio preview transcodes
  - video transcodes
  - font preview publishing
- Malware detections now freeze/reject affected assets and fail remaining queued jobs for that asset

## What still needs real-world verification or more polish

These are the main items that still need a deployment validation pass or further operational hardening:

- **Live Stripe Connect verification** against real connected accounts, real refunds, disputes, transfer reversals/restores, and payout settlement events
- **Live Stripe Tax verification** for the categories, products, and jurisdictions you intend to sell into
- **Production-grade distributed rate limiting** beyond the current audit-backed approach if you plan to run many web replicas under sustained attack
- **Formal legal workflow polish** for takedowns, evidence handling, notice retention, and escalation procedures
- **Worker host dependencies** such as ClamAV, FFmpeg, ImageMagick, Poppler, and font tools installed/configured in your deployment environment
- **Operational observability** such as alerting, queue dashboards, dead-letter handling, and reconciliation playbooks

## Environment

At minimum, configure:

- `DATABASE_URL`
- `AUTH_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_BASE_URL`
- `S3_REGION`
- `S3_ENDPOINT` (for S3-compatible providers such as R2 or MinIO)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_PUBLIC_BUCKET`
- `S3_PUBLIC_BASE_URL`
- `S3_PRIVATE_BUCKET`

Useful optional variables:

- `SITE_SLUG`
- `MARKETPLACE_FEE_BPS`
- `MAX_PREVIEW_BYTES`
- `MAX_DOWNLOAD_BYTES`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`
- `WORKER_BATCH_SIZE`
- `WORKER_POLL_MS`
- `AUDIO_PREVIEW_DURATION_SECONDS`
- `VIDEO_PREVIEW_DURATION_SECONDS`
- `CLAMSCAN_PATH` or `CLAMD_HOST` / `CLAMD_PORT` / `CLAMD_SOCKET_PATH`
- `FFMPEG_PATH` / `FFPROBE_PATH`
- `IMAGEMAGICK_CONVERT_PATH` / `IMAGEMAGICK_IDENTIFY_PATH`
- `PDFTOPPM_PATH` / `PDFINFO_PATH`
- `FCSCAN_PATH` / `FC_SCAN_PATH` / `OTFINFO_PATH`
- `PYFTSUBSET_PATH`

## Setup

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

The seed creates all supported marketplaces and a super admin account.

## Deployment notes

- Deploy the same repo to one or more domains.
- The app first resolves the active site from the incoming hostname, then falls back to `SITE_SLUG`.
- Supported built-in hostnames now include `createcanyon.com`, `graphicgrounds.com`, `melodymerchant.com` (and `melodymercant.com` as an alias), `programplaza.com`, and `filefoyer.com`, plus matching `www.` and `.localhost` hosts.
- Store public previews in the public bucket and original download files in the private bucket.
- Downloads are served through signed URLs after entitlement and compliance checks pass.
- Stripe webhooks use raw request body verification.
- Run the worker alongside the web app if you want malware scanning and derived previews.

## Default admin

Unless overridden with environment variables:

- Email: `admin@example.com`
- Password: `admin1234`

Change these immediately in production.

## Background worker

Run the worker with:

```bash
npm run worker
```

The worker performs malware scanning, metadata extraction, and preview generation, but it requires the corresponding host binaries/services to be installed in the environment where the worker runs.
