# Implementation and acceptance matrix

This matrix describes code present in this delivery, not a claim that unexecuted integrations pass. “Implemented source” means non-placeholder handlers, data flow or UI exist. “Partial” identifies a meaningful limitation. “Not implemented” is intentionally explicit. The larger brief contains considerably more functionality than the core vertical slice delivered here.

| Area | Source delivered | Status and limitations |
| --- | --- | --- |
| Five applications | Three Next.js apps; Nest/Fastify bootstrap/root module; parameterized worker app | Implemented source; full build and start not verified |
| Five branded channels | Host allowlist, channel branding, categories, SSR catalog and product pages | Implemented source; an additional brand still needs enum/branding changes |
| Canonical items and cross-listing | Item/version/listing model, DB eligibility table and trigger, origin and primary channel handling | Implemented source; schema-driven specialist metadata validation remains basic |
| Immutable product releases | Submitted-version and processed-file content guards; new versions instead of replacement | Implemented source; migration behavior not yet executed against PostgreSQL |
| Identity | OIDC authorization code, PKCE, nonce/state, signature/audience checks, Redis opaque sessions, refresh serialization | Implemented source; real IdP interoperability, logout and revocation not verified |
| Administrative / seller MFA | Recent signed authentication methods/time guards; stronger admin guard; Keycloak flow configuration | Implemented source; Keycloak import and seller conditional step-up setup require verification |
| Network carts | Authenticated server-side carts, source listing/channel, reprice on checkout | Implemented source; anonymous cross-domain guest-cart exchange is NOT implemented |
| Multi-seller checkout | One order/PaymentIntent with immutable per-line price/license/seller/tax snapshots | Implemented source; Stripe integration and concurrent checkout not exercised |
| Buyer library | Order/entitlement ownership, private signed original downloads, certificate JSON verification, download history | Implemented source; a full buyer UI for filtering history and version-update entitlements is partial |
| Licensing | Versioned templates, exact purchased text, HMAC certificate payload, revocation metadata | Implemented source; seed text is DEMO ONLY, not legal documents; no PDF certificate generation |
| Stripe Connect | One account per seller, hosted and embedded onboarding endpoints, account status updates, guarded account changes | Implemented source; embedded UI is not complete; real onboarding untested |
| Stripe Tax | Calculation, per-line tax snapshots, finalization and proportional transaction reversal jobs | Implemented source; marketplace tax responsibility/registrations/product tax codes require review |
| Ledger | Append-only journals/lines, deferred balance/currency constraints, integer amounts, provider-fee entries | Implemented source; no live database verification or independent accounting acceptance |
| Transfers and reserves | Reserve eligibility, seller holds/status checks, provider idempotency, transfer groups and reversals | Implemented source; full cross-border/currency policy, reserve modeling and operational recovery are not complete |
| Partial/full refunds | Integer cumulative allocation, request serialization, payment/refund records, line revocation on full refund, transfer reversal jobs | Implemented source; external Stripe statuses/webhook races remain untested |
| Disputes / payouts | Provider event records, fee/suspense/loss journals, entitlement restriction and payout status handling | Partial: not a complete dispute-evidence UI or comprehensive seller-loss/negative-balance recovery policy |
| Reconciliation | Provider reads during recovery and reference-based postings | Partial: no full daily Stripe-to-ledger reconciliation/reporting service |
| Uploads | Private quarantine, single PUT and real multipart URLs, resume/list/complete/abort, checksum and actual-size validation | Implemented source; S3/MinIO multipart browser interoperability untested |
| Archive security | Python streaming ZIP/TAR/GZIP inspection; paths, links, devices, encryption, depth, file/size/ratio and nesting limits | 16 real regression tests pass; parser fuzzing and production adversarial assessment not complete |
| Antivirus | Framed ClamAV INSTREAM with fail-closed size, error, timeout and truncated-response handling | Mock-server protocol tests pass; real daemon/signature behavior not exercised |
| Isolated processing | Separate parser container, no network, non-root, resource bounds, read-only input/rootfs; SHA-256 pinning | Implemented source; production cross-account IAM and remote isolated executor not provisioned |
| Image previews | Sharp signature validation, orientation/metadata handling, resize and visible watermark; public generated raster only | Implemented source; real image processing untested; no perceptual similarity service |
| Audio previews | FFmpeg short preview and waveform; basic ffprobe metadata | Partial: no robust watermarking, fingerprinting, Content-ID workflow or complete music metadata UI |
| Document previews | Archive/macro restrictions, isolated LibreOffice, qpdf and rasterized first-page previews | Partial: not comprehensive CDR, page navigation, malicious-document certification or all source formats |
| Code scanning | Platform-owned static tool commands for Gitleaks/Trivy/Semgrep/Syft; common tree includes nested archives; no uploaded code execution | Partial: tool binaries/databases/configuration hardening and sandbox validation require independent integration work; generated SBOM is not yet a buyer-facing retained artifact |
| Fonts / vectors / 3D | Asset model, eligibility and license seed coverage | Partial: no OTS/font specimen pipeline, specialist vector rasterization, Blender or full 3D processing; unsupported files remain unavailable/rejected rather than executed |
| Search | Per-channel Typesense documents, rehydration through authoritative DB view, PostgreSQL full-text/ILIKE fallback, sort/filter controls | Implemented source; search synchronization/load tests unrun; autocomplete/synonym management and ranking experiments partial/not implemented |
| Reviews | Verified entitlement/purchase checks, self-purchase restriction, published reviews, moderation and seller response | Implemented source; advanced review fraud detection not implemented |
| Support | Order-linked cases, participant authorization, buyer/seller messages, admin-only internal notes | Implemented source; attachments, SLA automation and full operational tooling not implemented |
| Seller studio | Organisation creation, terms acceptance, products/pricing/listings/new versions/uploads, statements, support | Implemented source; full team invitations/ownership transfer, tax documents, broad analytics and bulk imports missing |
| Moderation and claims | Case queues, scan-aware approval, seller suspensions/holds, public item report, claim state controls | Implemented source; legal deadline/counter-notice evidence management and duplicate-content detection partial |
| Audit | Database hash chain, append-only sensitive records and verification endpoint | Implemented source; no independently stored daily signed checkpoints or privileged-administrator tamper-proof guarantee |
| Notifications | In-app records/read state, outbox-driven SMTP/Mailpit or optional SES sending | Implemented source; SES credentials/delivery and provider duplicate behavior untested |
| Wishlists | Authenticated saved-item API/UI | Implemented source; private collections, sharing and broader discovery tooling missing |
| SEO / accessibility | Primary canonical metadata, sitemap/robots controls, product data, semantic forms/navigation/focus styles | Partial: no WCAG 2.2 AA certification, crawl validation, comprehensive keyboard/browser audit or slug redirect history |
| Local infrastructure | Compose for PostgreSQL, Redis, MinIO, Typesense, Keycloak, Mailpit, ClamAV; role grant script | Source provided; images/service readiness/imports not executed; some development images use mutable tags |
| Migrations / seeds | Four explicit migrations, 48 tables, licenses including music/font/code, demo fixtures and commerce scenarios | Source provided; database tests have been added but not run |
| CI | Locked install, source/Python tests, build/typecheck, DB tests, audit and release gate workflow | Not run; intentionally blocked until a real reviewed lockfile and patched Next baseline exist |
| Infrastructure/security operations | Container recipes and deployment guidance | Partial: no AWS/OpenTofu deployment, production RLS policies, WAF, observability backend, backup/restore drill, cross-account scan service or signed release pipeline |
| Fraud, growth and account lifecycle | Basic self-purchase, roles, holds, download velocity and request limits | Partial: no complete risk scoring, account export/deletion, active-device manager, subscription revenue allocation, affiliates, bundles, CMS/campaigns, team licenses or mobile apps |
| Legal / commercial decisions | Explicit configuration boundaries and demo-only license text | Not resolved: merchant-of-record model, supported countries/currencies, tax obligations, refunds/consumer rights, privacy, trademark clearance and legally reviewed agreements |

## Release blockers

A patched, reviewed dependency baseline and real lockfile; full TypeScript/build and migration success; genuine OIDC/MFA claim tests; Stripe test-mode payment/refund/dispute/transfer/tax acceptance; object-storage isolation and hostile-upload testing; configured scanner binaries/databases and independent sandbox assessment; production legal/accounting/operational approval. There may be further defects revealed by these tests. No known untested boundary should be interpreted as a promise of correctness.
