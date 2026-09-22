-- Run as the migration owner after migrations. The normal API never owns its tables.
GRANT CONNECT ON DATABASE createcanyon TO createcanyon_app;
GRANT USAGE ON SCHEMA public TO createcanyon_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO createcanyon_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO createcanyon_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO createcanyon_app;
REVOKE ALL ON schema_migration FROM createcanyon_app;
-- Immutable data can be inserted, but never edited or deleted by the runtime role.
REVOKE UPDATE, DELETE ON audit_event, journal, journal_line, license_certificate, seller_terms_acceptance, order_line FROM createcanyon_app;
-- Reference-data and contract changes belong to reviewed migrations, not the public API.
REVOKE INSERT, UPDATE, DELETE ON storefront, channel_eligibility, metadata_schema, license_template, seller_terms FROM createcanyon_app;
-- This is least-privilege ownership separation, not an RLS implementation.

GRANT UPDATE(revoked_at,revocation_reason) ON license_certificate TO createcanyon_app;
