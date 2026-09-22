# CreateCanyon Network — repaired source delivery

**Delivery date: 22 September 2026 · local-development implementation · public release blocked**

This ZIP is a substantial reconstruction of the supplied partial repository, not a certification that the entire 18-section product plan is finished. It contains real application code for the marketplace foundation and core workflows. It has not been dependency-installed, fully type-checked, built, or exercised against the external services in the delivery environment. Read **[the verification report](docs/VERIFICATION.md)** and **[implementation matrix](docs/IMPLEMENTATION_MATRIX.md)** before treating a feature as accepted.

## Critical dependency notice

The checked npm `next/latest` response was **16.3.5**. Next.js announced an upcoming critical upstream security update for **22 September 2026**, with planned releases **16.3.6 / 15.5.26**. Publication of the patch and the complete impact advisory was not established at delivery. The source retains the registry-observed exact pin for isolated local development; it is **not approved for Internet exposure**. `pnpm release:check` and the Vercel build commands deliberately block that pin, missing lockfiles, and unapproved release reviews. Review the complete advisory and update every Next.js consumer before generating the production lockfile. The version floor alone is not a complete vulnerability assessment. See [SECURITY](docs/SECURITY.md).

## Applications

| Application | Location | Local address | Purpose |
| --- | --- | --- | --- |
| Storefront | `apps/storefront` | `http://localhost:3000` | Five allowlisted branded channels, catalog, item pages and seller portfolios |
| Account dashboard | `apps/dashboard` | `http://localhost:3001` | Buyer library, checkout, support and seller studio |
| Restricted administration | `apps/admin` | `http://localhost:3002` | Moderation, financial exceptions, claims, support, audit and failed jobs |
| NestJS/Fastify API | `apps/api` | `http://127.0.0.1:4000/v1` | Authoritative authentication, authorization and marketplace operations |
| Workers | `apps/workers` | No public HTTP endpoint | Durable outbox consumers for files, search, payments, tax, transfers and notifications |

Specialist storefronts: `http://graphicgrounds.localhost:3000`, `http://melodymerchant.localhost:3000`, `http://filefoyer.localhost:3000`, `http://programplaza.localhost:3000`. These names must resolve to loopback in your browser/OS; add explicit loopback hosts entries when required. Do not browse the account applications as `127.0.0.1`: the development OIDC callbacks and WebAuthn relying party use `localhost`.

The incorrect root Vercel configuration that attempted to serve API build output as a website has been removed. Each Next.js application has its own project configuration. No DNS records or cloud deployments were changed by this delivery.

## First local setup

Prerequisites: Node 22.16 or newer on the Node 22 release line (matching the root `engines` field), Corepack/pnpm, Docker with Compose, Python 3, and network access to install dependencies and images. On Windows, use WSL2 for the POSIX processor and permission model. Keep the application loopback-only while the dependency security notice is unresolved.

```sh
cp .env.example .env
corepack enable
# First bootstrap only. A real lockfile could not be produced offline.
corepack pnpm install --no-frozen-lockfile
# Review the generated pnpm-lock.yaml and all install warnings.
pnpm build
pnpm infra:up
```

Wait for the services to report healthy before the following commands. ClamAV needs a usable signature database; its container being started is not evidence that scanning is ready.

```sh
pnpm db:migrate
pnpm db:grant
pnpm db:seed
pnpm processor:build
# Optional: private tiny fixture files + clearly marked demonstration transactions.
pnpm demo:load
pnpm dev
```

`pnpm build` in this sequence is a required verification step, not a build already proven by this delivery. Correct any dependency-resolution, compatibility or type errors it surfaces before proceeding. The strict compiler configuration is retained. Root scripts read `.env`; existing shell variables take precedence. Never commit `.env`.

`db:migrate` uses the separate migration-owner URL and checks applied migration hashes. `db:grant` sets up the development runtime role's permissions. `db:seed` creates reference data, users, seller organisations, draft products and deliberately non-production license/terms text. It does **not** claim to have scanned or published any file. `demo:load` is a separately guarded loopback-only helper: it uploads repository-generated fixtures, marks them as unscanned demonstrations, and creates stub orders, licenses, ledger entries, transfers, a partial refund/reversal, a review, support and notifications. It does not charge anyone. The font example stays a draft and contains no font file.

The default payment mode is `stub`, tax is `disabled`, and mail goes to Mailpit. These modes are for local development only; production environment parsing rejects the payment/tax bypasses. Actual seller uploads still use antivirus and isolated parsing by default.

## Development accounts and services

| Account | Username | Development-only password |
| --- | --- | --- |
| Buyer | `buyer` | `Local-buyer-only-2026!` |
| Seller | `seller` | `Local-seller-only-2026!` |
| Application administrator | `admin` | `Local-admin-only-2026!` |

Keycloak console: `http://localhost:8080`, realm `createcanyon`. Its local realm-management user is `local-admin` with password `local-keycloak-admin-change-me`. MinIO console: `http://localhost:9001`. Mailpit: `http://localhost:8025`. Other local credentials are intentionally public fixtures in `.env.example`; replace all of them outside disposable development.

Admin access requires an actual recent phishing-resistant authenticator execution, not just the admin password. The realm includes a WebAuthn flow, but its import and emitted token claims were not tested here. Register an authenticator and follow [the identity-provider notes](infra/keycloak/README.md). Seller payout changes likewise require recent MFA; ordinary password-only dashboard login deliberately cannot satisfy that requirement. Do not remove the guards or synthesize privileged token claims to make a demonstration work.

## Run checks

```sh
pnpm test:offline       # Source-level Node regression suite
pnpm test:python        # Actual Python archive-guard regression suite
pnpm typecheck         # Full dependency-aware TypeScript checks (not run at delivery)
pnpm test              # Workspace test runners
pnpm build             # All applications/packages (not run at delivery)
pnpm release:check     # Expected to fail for this unreleased dependency baseline
```

For database tests, provision a **separate disposable database whose name ends in `_test`**, set `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `INTEGRATION_DATABASE_URL` to it, run `db:migrate` and `db:seed`, then `pnpm test:integration`. Do not use a production or populated development database: some append-only test records intentionally remain. This suite tests database constraints, not live Stripe or OIDC.

For browser smoke tests, start the local stack and applications, install the Playwright Chromium browser (`pnpm exec playwright install chromium`), then `pnpm test:e2e`. Authentication, payment-webhook replay, uploads and MFA still require the acceptance scenarios in [VERIFICATION](docs/VERIFICATION.md). Browser smoke tests do not replace those scenarios.

## Operating the workers

For local development, `WORKER_KIND=all` runs one worker loop. In deployed environments run separate processes with `WORKER_KIND=files`, `search`, `payments`, `tax`, `transfers` and `notifications`. All use the same worker application with different event subscriptions. PostgreSQL outbox rows are claimed with leases and `SKIP LOCKED`, retried with backoff, and moved to a failed state after the configured attempt limit. The admin console has reason-required retry controls. At-least-once processing and email delivery must not be confused with exactly-once external effects.

The file orchestrator invokes a network-disabled, non-root parser container. It never imports, installs or runs uploaded application code. The parser image includes image/audio/document tooling and the archive guard. The four optional code-scanner binaries and their databases are **not** all installed in the supplied development image; production code publication is blocked until all required scans are complete. See the matrix for unsupported processors and the isolation work still required for a production cloud environment.

## Deployment and further work

Read [DEPLOYMENT](docs/DEPLOYMENT.md), [SECURITY](docs/SECURITY.md), [VERIFICATION](docs/VERIFICATION.md), and [IMPLEMENTATION_MATRIX](docs/IMPLEMENTATION_MATRIX.md). They distinguish source implementation, actual checks, untested integrations and missing product/operational scope. The ZIP contains no real keys, dependency directory, generated lockfile, build output or third-party font assets. The original repository license is preserved.
