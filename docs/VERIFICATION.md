# Verification report

**Source delivery date: 22 September 2026.** This report separates executed checks from unexecuted source/integration work. It is not a release approval.

## Executed successfully

| Check | Actual result | What the result establishes |
| --- | --- | --- |
| Node source-level regression suite | **23 tests passed; 0 failed; 0 skipped** | Tests execute source-transpiled pure modules, mock-network antivirus code and structural assertions |
| Python archive-guard regression suite | **16 tests passed** | Tests execute the actual Python archive inspector against generated hostile/safe fixtures |
| TypeScript/TSX syntax transpilation | **132 source files; no syntax diagnostics** | Parses/transpiles source; does NOT resolve application dependencies or prove type correctness |
| Relative source imports | No missing relative TypeScript import target found | Does not verify third-party package exports or workspace build output |
| JSON/YAML parsing before packaging | 46 documents parsed | Syntax parsing only, not Docker, Keycloak, CI or Vercel semantic validation |
| Release guard | Exited **1**, as intended | Rejects the current pre-update Next.js pins, absent lockfile and missing review approval |

Executed with Node **22.16.0**, Python **3.13.5** and locally available TypeScript **5.8.3**. The repository selects Node 24 and declares TypeScript 5.9.3; those are not the toolchain versions used for this offline syntax run. No compiler flags were relaxed to manufacture a successful full build.

Actual output is retained in `docs/verification/node-tests.tap`, `archive-tests.txt`, and `release-check.txt`. The Node test runner transpiles selected source modules with a local TypeScript compiler; it does not substitute fake payment/OIDC libraries and does not count unexecuted provider workflows as passes.

### Node coverage

SHA-256 standard, million-byte and padding-boundary vectors checked against Node crypto; incremental hashing and bounded Blob chunks; cancellation; deterministic monetary allocations and thousands of cumulative cent-sized refunds; safe-integer conversion; application-level journal validation; all five allowed hostnames and spoofed-host cases; login return-path restrictions; ClamAV framed clean replies, malware/error replies, truncated/empty responses, timeout and size failure using local mock TCP servers; minimum-version/review release guards; relative import targets; five application/migration presence; TypeScript/TSX syntax and storefront Vercel project configuration.

### Archive coverage

Safe ZIP and TAR handling; traversal/absolute/Windows-style paths; symlink/hardlink/device rejection; case-colliding files; entry/expanded-size/compression-ratio/path-depth/nesting bounds; nested manifests; gzip expansion limits; CRC and encrypted-flag rejection; ordinary non-archive code is never executed. These are representative regressions, not comprehensive fuzzing, codec validation or a sandbox escape audit.

## Not executed / not established

Package-registry access failed during the work. No dependency installation was completed, and no authentic pnpm lockfile could be generated. pnpm, Docker, PostgreSQL and the complete application dependency graph were not available locally. Consequently:

- `pnpm install`, full dependency-aware `pnpm typecheck`, `pnpm build`, workspace Vitest and dependency audit were **not completed**. Installation/compatibility/type errors may still be revealed by those steps.
- Migrations and deferred database constraints were **not run against PostgreSQL**. The supplied database integration suite is real test code, but is **unexecuted**. SQL source review is not a migration pass.
- No Compose image was pulled or started. PostgreSQL grants, MinIO policies/CORS/versioning, Typesense, Keycloak realm import/MFA claims, Mailpit and the real ClamAV daemon were **not validated as a connected stack**.
- No Next.js browser screenshot, Playwright browser run, authenticated navigation or accessibility audit was completed. The browser smoke suite is **unexecuted**.
- No real Stripe PaymentIntent, Tax calculation/transaction, Connect onboarding, refund, transfer, reversal, dispute, payout or webhook-replay acceptance scenario was completed. No money was moved.
- No real S3 multipart session or entitlement download was run. The demo loader was not run. Its generated sample records must not be cited as tested commerce.
- Sharp/FFmpeg/LibreOffice/qpdf and the external code-scanner integrations were not executed together. The archive tests do not test these parsers or certify the generated preview pipeline.
- No DNS, Vercel, identity-provider, payment-provider, AWS or production system was changed. The original live 404 was not remotely redeployed or verified as resolved.

## Required next acceptance run

First resolve the current framework security notice and generate/review an actual lockfile. Run a frozen install, full strict typecheck and all builds. Start the local services, apply migrations to an empty disposable database and run the supplied database suite. Verify Keycloak with genuinely signed audience/AMR/authentication-time claims and an actual authenticator; do not bypass the guards.

Then exercise browser flows with two different buyers, a seller and a strong-MFA admin. Cover every channel, logout/refresh, unauthorized resource access, upload resume/abort/checksum mismatch, scanner outage and hostile files, human moderation, purchase snapshots, multi-seller cart repricing, duplicate checkout, real test-mode Stripe webhooks, partial/full refunds before and after transfer, transfer holds, disputes and tax adjustments. Check public-original denial, cross-buyer denial, revoked download denial, audit-chain verification and failed-job recovery. Add concurrency, provider-failure and migration-upgrade/restore tests.

Obtain independent security/accounting/legal acceptance and complete the missing production infrastructure and operational scope in IMPLEMENTATION_MATRIX before setting the approval flags. The current ZIP is a source implementation with an honest offline verification boundary, not evidence that all of the original build plan has been completed.
