# Security status and boundaries

**This is not a penetration-tested or production-certified platform.** Report suspected defects privately to the deployment owner's security contact. A network security mailbox has not been provisioned by this source delivery.

## September 2026 framework security update

Next.js announced an out-of-band update to 16.3.6 and 15.5.26 for a critical upstream issue. This workspace now pins the 16.3.6 security release across every Next.js consumer. Sources to review before approving a public release:

- https://nextjs.org/blog/upcoming-nextjs-security-release-september-22-2026
- Advisory named by that announcement: GHSA-vcvr-r3jv-pc5j.

The Next.js 16.3.6 pins satisfy the known minimum version gate. Public release remains deliberately blocked until the complete advisory (including any React or other dependency remediation it specifies) has been reviewed, the lockfile has been generated and reviewed, and the full acceptance suite has passed. Set `RELEASE_REVIEW_APPROVED=true` in the deployment environment only after completing that review. The floor in the check is a known-minimum gate, not a substitute for checking later advisories.

## Implemented controls

The source includes first-party opaque HttpOnly sessions, server-side encrypted token storage, PKCE/state/nonce checks, signed OIDC verification, per-resource API authorization, MFA recency checks, hostname allowlists, CSRF checks on browser proxy mutations, a nonce-based script CSP, server-side prices, immutable order/license snapshots, signed payment webhooks, private quarantine/originals, scan-aware moderation, private entitlement downloads, append-only journal/audit guards and financial/provider idempotency references. Read the actual code and tests; source presence alone does not establish that all controls are effective together.

All developer passwords and license/terms text in this ZIP are intentionally non-production examples. Production flags forbid the main local authentication, payment, tax and unscanned-file bypasses. Never set approval flags merely to silence a startup error. The separate demo loader deliberately manufactures development records and must never be adapted into a production upload approval path.

## Important residual risk

Full package installation, dependency audit, TypeScript checking, application builds, PostgreSQL constraint execution, OAuth/MFA interoperability, provider integration and independent penetration testing were not completed here. Only the tests identified as executed in VERIFICATION passed. There is no safe inference from those tests to production readiness.

Runtime role grants are separate from the migration owner, but comprehensive PostgreSQL RLS policies are **not implemented**. Account lifecycle/export/deletion, sophisticated anti-fraud rules, global session revocation propagation, device management, comprehensive secret redaction, distributed rate limiting and infrastructure policy checks need additional engineering. The global in-memory API IP limiter is not a complete network abuse-control system.

The processor container provides useful resource/network/process boundaries but is not a microVM or a separately provisioned production security account. The local orchestrator uses a Docker executor and has database/storage access; production must isolate that executor and split permissions. Uploaded application code is never intentionally executed. Hostile parsers can still have vulnerabilities: keep their dependencies patched, fuzz/scan the pipeline and test escapes. Native processor mode is local-development-only.

ProgramPlaza integrations are not a security verdict until actual trusted scanner binaries, rules, offline vulnerability databases, ignore/config behavior and failure handling are reviewed and exercised. The four scanner binaries are not all supplied in the development processor image. Static scanning cannot prove software harmless. The supplied Semgrep rules are illustrative, not a complete malicious-code detector. Font sanitizer/specimen processing and complete specialist pipelines remain unfinished. Archive limit checks do not certify every codec or document parser.

Audit hashes are tamper-evident relative to their history, not magically immutable against the database owner. Export independent signed checkpoints and protect backups. Financial journals balance by construction/constraint, but accounting correctness, seller-loss allocation, reconciliation and applicable tax/legal rules still need professional and integration acceptance.

## Dependency and release hygiene

Direct application dependencies use exact pins. Some local Docker tags and CI action major tags are mutable, and processor OS packages are not immutable-digest pinned. Generate and review the lockfile, pin approved images/actions by verified digest/commit, scan dependencies and containers, produce retained SBOMs and sign deployment artifacts before production. Do not infer a completed supply-chain program from the starter CI file.
