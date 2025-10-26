# Storefront Multi‑Vendor (Next.js + Prisma + Stripe + S3)

A reusable, single‑codebase marketplace for digital creative assets that you can deploy to **five branded sites**:

- **CreateCanyon** – All kinds of creative assets
- **GraphicGrounds** – Image assets
- **MelodyMerchant** – Sound assets
- **ProgramPlaza** – Code assets
- **FileFoyer** – File assets

Each deployment is configured by `SITE_SLUG`, but uses the same repo. Vendors upload assets, admins approve categories/vendors/assets, buyers preview and purchase, and purchasers get secure, time‑limited downloads.

---

## Features

- Next.js App Router + TypeScript + Tailwind
- Email/password auth (JWT cookie) — no third‑party auth needed
- Prisma (PostgreSQL)
- Stripe Checkout + webhook fulfillment
- S3‑compatible storage for previews (public) and downloads (private)
- Vendor dashboard (apply, upload, manage, sales)
- Admin console (categories per site, vendor approvals, asset approvals)
- Image/Audio/Video preview components

---

## 1) Setup

### Prerequisites

- Node 18+
- PostgreSQL (e.g., Neon/Supabase/RDS)
- Stripe account
- S3‑compatible storage (AWS S3, Cloudflare R2, MinIO, etc.)

### Install

```bash
pnpm i    # or npm i / yarn
cp .env.example .env
# edit .env values
```

Set `SITE_SLUG` to one of: `CreateCanyon | GraphicGrounds | MelodyMerchant | ProgramPlaza | FileFoyer`.

### Database

```bash
npm run db:push     # create tables
npm run db:seed     # create site + default categories + admin user
```

> Admin user (for first login): `admin@example.com / admin1234` (change immediately).

### Dev

```bash
npm run dev
```

Open http://localhost:3000

---

## 2) Storage (S3)

- Put previews in a **public** bucket (set `S3_PUBLIC_BUCKET` + `S3_PUBLIC_BASE_URL` to the public domain/CDN for the bucket).
- Put downloads in a **private** bucket (`S3_PRIVATE_BUCKET`). Downloads are served via a **signed URL**.

The dashboard upload page calls `/api/upload/presign` to get a signed `PUT` URL, then uploads files directly from the browser.

---

## 3) Stripe

- Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` in `.env`.
- Create a webhook endpoint in Stripe pointing to `/api/webhooks/stripe` (Vercel production URL).
- On payment success, the webhook marks the order as `paid` and grants a `Purchase` record.

---

## 4) Roles & Flow

- **User**: Sign up → Buy assets → Download.
- **Vendor**: Apply in Dashboard → **Admin approves** → Upload assets (pending) → **Admin approves** → Listed for sale.
- **Admin**: Set per‑site categories, approve vendors/assets.

---

## 5) Multi‑Site Reuse

Deploy this same repo 5× to Vercel with different env vars per project:

```
SITE_SLUG=CreateCanyon
SITE_SLUG=GraphicGrounds
SITE_SLUG=MelodyMerchant
SITE_SLUG=ProgramPlaza
SITE_SLUG=FileFoyer
```

Categories are stored per site in the DB. The seed script creates defaults you can edit in the Admin UI.

---

## 6) Security Notes

- Change `AUTH_SECRET` to a long random string.
- Change the seeded admin password immediately.
- Restrict your Stripe webhook to production URL and verify signatures (already enabled).
- Set proper CORS and bucket policies for public previews vs private downloads.

---

## 7) Deploy to Vercel

1. Push this repo to GitHub.
2. Import into Vercel.
3. Set all required env vars for each project (see `.env.example`).
4. Add a Stripe webhook for the production URL.
5. Add a storage provider (S3/R2/MinIO) and fill credentials.

Vercel will run `postinstall` → `prisma generate`. Run `npm run db:push` and `npm run db:seed` once via Vercel CLI or locally pointing to the prod DB.

---

## 8) What’s intentionally simple?

- Taxes/VAT: not included.
- Payouts: Track sales in “Sales & earnings”; pay vendors manually or extend with Stripe Connect.
- Licenses: Simple single‑user license text on the product page — adjust to your needs.
- Preview security: Previews are public by design; keep downloads private.

Extend as you like — this is a solid, production‑deployable foundation.
