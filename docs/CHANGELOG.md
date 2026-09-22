# Rebuild change summary

The uploaded ZIP contained 78 files. The existing useful schema/domain/authentication conventions were retained and extended, rather than discarding the entire repository.

The main changes are the three missing web applications; real API bootstrap/module composition and raw webhook handling; six worker subscriptions; explicit migrations and database invariants; shared payment/refund/tax/transfer logic; buyer and seller account workflows; scan-aware moderation/claims/support; multipart uploads and a separately isolated parser; real local infrastructure configuration; reference and optional demonstration seeds; and regression, integration and smoke-test sources.

The API-output-as-static-storefront root Vercel configuration was removed and replaced with per-Next-app project configurations. Public release is intentionally blocked pending the framework security update, authentic lockfile and acceptance review. No external deployment was performed.

`SOURCE_CHANGES.json` lists 151 added files, 44 modified files, 0 removed files and 34 unchanged files relative to the original ZIP, as measured before adding this changelog and the inventory itself. This is a source inventory, not a fabricated git history.

See IMPLEMENTATION_MATRIX for remaining product scope and VERIFICATION for the exact executed test boundary. Particularly, a syntax pass is not a full application build, the mock ClamAV protocol tests are not a real malware scan, and the local fixtures are not real purchases or reviewed commercial assets.
