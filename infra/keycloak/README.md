# Local identity provider

The import defines three **confidential, PKCE-only authorization-code clients** with exact localhost callbacks, a shared API audience, and buyer/seller/admin development identities. Use `localhost`, not `127.0.0.1`, in browser URLs so the issuer and WebAuthn relying-party ID agree.

Admin client login uses the `cc-phishing-resistant` flow: a password plus a real WebAuthn authenticator. The administrator must register a security key or platform authenticator. AMR is derived from completed authenticator executions (`default.reference.value` and `default.reference.maxAge`), not a static privileged claim. The API requires `webauthn`/`hwk`/`passkey` and a signed recent `auth_time` claim. A password alone does not unlock administration.

**This realm import has not been executed in this environment.** Check the imported flow and signed token claims against your installed Keycloak version. Failure to emit the required claims results in denied access; do not bypass the guard or add a hard-coded `amr=webauthn` mapper. After first credential registration, log in again so a genuine WebAuthn execution appears in the access token.

For seller payout setup, configure dashboard step-up with an appropriate ACR-to-MFA flow before using Stripe. The development dashboard uses the standard Keycloak browser flow; its ordinary password-only session intentionally cannot make payout-account changes. To test locally with a key, bind `cc-phishing-resistant` to the dashboard client as well, register a credential in the Keycloak Account Console, then sign in again. Production should use a dedicated conditional step-up flow rather than forcing every buyer through seller MFA.

Development users: `buyer` / `Local-buyer-only-2026!`, `seller` / `Local-seller-only-2026!`, `admin` / `Local-admin-only-2026!`. Keycloak realm administrator: `local-admin` / `local-keycloak-admin-change-me`. These credentials are intentionally public fixtures. Never import this realm into production. Keycloak imports run only when a realm is absent; reset the local database volume or apply intentional configuration changes in the console after edits.

Production requires HTTPS, verified email, private administrative access, reviewed flow bindings, passkey enrollment/recovery procedures, scoped roles, rotated client secrets, and tested logout/token-revocation behavior. No production identity service is provisioned by this repository.
