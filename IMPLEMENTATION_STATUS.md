# CreateCanyon Updated v8 Status

## Included in this zip

This package rolls forward the previous v7 source and closes the major remaining gaps that were still marked as “mostly done”, “partly done”, or “improved but not finished”.

### Compliance and support enforcement
- Download enforcement now blocks access when:
  - the asset is not approved
  - downloads are frozen
  - the seller membership is not approved
  - request bursts exceed the abuse threshold
- Admin support reviews now execute real backend actions instead of only updating case status.
- Supported admin action modes now include:
  - `refund`
  - `partial_refund`
  - `freeze_downloads`
  - `takedown`
  - `reinstate`
  - `dispute_hold`
  - `dispute_release`
  - `dispute_lost`
- Support review updates are now **strict** about action failures: if the action fails, the case status is left unchanged and the failure is recorded.
- Support warnings are preserved in review notes and support audit logs.

### Seller edits and version validation
- Version upload presigning now requires category-aware validation inputs.
- Version creation re-validates replacement files against category rules before accepting them.
- Seller edit routes now revalidate preview type, metadata, price, and category/file compatibility.
- Seller changes that materially affect the asset can push the asset back into moderation review.

### Money flow, refunds, disputes, and payout visibility
- Support-triggered refunds now call Stripe and create refund audit trails.
- Refund webhooks update order state, write seller refund ledger adjustments, and reverse seller transfers.
- Dispute handling now supports both webhook-driven and manual admin-driven reserve / release / loss actions.
- Dispute release can restore previously reversed seller transfers.
- Seller payout pages now surface dispute reserve/release activity, restored transfers, payout settlement adjustments, and transfer lifecycle details.

### Auth and API hardening
- `AUTH_SECRET` is required.
- Auth middleware / wrappers return clean auth failures.
- Sign-in and sign-up use throttling plus audit-backed shared rate-limit tracking.
- Successful credential resets now clear the shared rate-limit bucket as a best-effort cleanup step.

### Search and discovery
- The `Popular` sort is implemented.
- Search now supports weighted relevance scoring over richer fields.
- Vendor filtering and facet groups are available on the search page.
- `/api/search` now supports vendor filters and optional metadata/facet responses.

## Verification completed in this environment
- Source-level review of the changed support, payment, auth, and search flows
- Internal consistency pass across the admin support UI, support action backend, dispute/refund money-flow code, and README/status docs

## Verification not completed here
- A fresh `npm install` + `npx tsc --noEmit` run was **not** completed inside this sandbox after the final v8 edits.
- No live end-to-end verification was performed against real:
  - Postgres
  - Stripe Checkout / Connect / refunds / disputes / payouts
  - Stripe Tax scenarios
  - S3/R2 storage
  - production multi-domain routing
  - worker-host binaries and services

## Remaining work after this zip
These are now mostly deployment / operational follow-ups rather than obvious missing source code blocks:

- Run real Prisma migration / generate steps against your target database
- Run a live Stripe Connect verification pass for refunds, disputes, transfer reversals/restores, and payout settlement events
- Run a live Stripe Tax verification pass
- Harden formal takedown evidence / notice / escalation workflow to match your legal process
- Add production observability and queue/reconciliation monitoring
