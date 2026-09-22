-- Transactional marketplace invariants. Changes belong in new migrations, never this file.
CREATE UNIQUE INDEX one_active_network_cart ON cart(user_id,currency) WHERE status='ACTIVE' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX one_checkout_per_cart ON customer_order(cart_id) WHERE cart_id IS NOT NULL;
CREATE UNIQUE INDEX one_primary_listing ON channel_listing(item_id) WHERE is_primary;
CREATE UNIQUE INDEX one_payment_per_order ON payment(order_id);
CREATE UNIQUE INDEX one_journal_reference ON journal(reference_type,reference_id);
CREATE UNIQUE INDEX audit_sequence_unique ON audit_event(sequence);
ALTER TABLE journal ADD COLUMN created_xid xid8 NOT NULL DEFAULT pg_current_xact_id();
ALTER TABLE customer_order ADD CONSTRAINT order_money_valid CHECK (
  subtotal_minor>=0 AND discount_minor>=0 AND tax_minor>=0 AND total_minor=subtotal_minor-discount_minor+tax_minor
);
ALTER TABLE order_line ADD CONSTRAINT order_line_money_valid CHECK (
  quantity BETWEEN 1 AND 100 AND unit_price_minor>=0 AND discount_minor>=0 AND tax_minor>=0 AND platform_fee_minor>=0 AND seller_earnings_minor>=0
  AND platform_fee_minor+seller_earnings_minor=quantity*unit_price_minor-discount_minor
);
ALTER TABLE refund_request ADD CONSTRAINT refund_shares CHECK (seller_minor>=0 AND fee_minor>=0 AND tax_minor>=0 AND seller_minor+fee_minor+tax_minor=amount_minor);
ALTER TABLE refund_request ADD CONSTRAINT refund_status_valid CHECK (status IN ('REQUESTED','PROCESSING','PENDING','SUCCEEDED','FAILED','CANCELLED'));
ALTER TABLE payment ADD CONSTRAINT payment_money_valid CHECK (amount_minor>=0 AND refunded_minor>=0 AND refunded_minor<=amount_minor);
ALTER TABLE seller_transfer ADD CONSTRAINT transfer_money_valid CHECK (amount_minor>=0 AND reversed_minor>=0 AND reversed_minor<=amount_minor);
ALTER TABLE catalog_item ADD CONSTRAINT current_version_exists FOREIGN KEY(current_version_id) REFERENCES item_version(id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION cc_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_order_line BEFORE UPDATE OR DELETE ON order_line FOR EACH ROW EXECUTE FUNCTION cc_immutable();
CREATE TRIGGER immutable_journal BEFORE UPDATE OR DELETE ON journal FOR EACH ROW EXECUTE FUNCTION cc_immutable();
CREATE TRIGGER immutable_journal_line BEFORE UPDATE OR DELETE ON journal_line FOR EACH ROW EXECUTE FUNCTION cc_immutable();
CREATE TRIGGER immutable_terms_acceptance BEFORE UPDATE OR DELETE ON seller_terms_acceptance FOR EACH ROW EXECUTE FUNCTION cc_immutable();
CREATE TRIGGER immutable_moderation_event BEFORE UPDATE OR DELETE ON moderation_event FOR EACH ROW EXECUTE FUNCTION cc_immutable();
CREATE TRIGGER immutable_audit_event BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION cc_immutable();
CREATE TRIGGER immutable_download_event BEFORE UPDATE OR DELETE ON download_event FOR EACH ROW EXECUTE FUNCTION cc_immutable();

CREATE FUNCTION cc_immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Versions cannot be deleted'; END IF;
  IF OLD.submitted_at IS NOT NULL AND
    (to_jsonb(OLD)-ARRAY['status','updated_at','approved_at','published_at','retired_at']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['status','updated_at','approved_at','published_at','retired_at']) THEN
    RAISE EXCEPTION 'Submitted version content is immutable; create a new version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE ON item_version FOR EACH ROW EXECUTE FUNCTION cc_immutable_version();
CREATE FUNCTION cc_immutable_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='READY' AND (TG_OP='DELETE' OR
    (to_jsonb(OLD)-ARRAY['state','updated_at','deleted_at']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['state','updated_at','deleted_at'])) THEN
    RAISE EXCEPTION 'Processed file content is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_file BEFORE UPDATE OR DELETE ON file_object FOR EACH ROW EXECUTE FUNCTION cc_immutable_file();
CREATE FUNCTION cc_immutable_license() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'License history cannot be deleted'; END IF;
  IF TG_TABLE_NAME='license_template' AND (to_jsonb(OLD)-ARRAY['active','retired_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['active','retired_at']) THEN
    RAISE EXCEPTION 'License template text is versioned, not mutable';
  ELSIF TG_TABLE_NAME='license_certificate' AND (to_jsonb(OLD)-ARRAY['revoked_at','revocation_reason']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['revoked_at','revocation_reason']) THEN
    RAISE EXCEPTION 'License certificate snapshot is immutable';
  ELSIF TG_TABLE_NAME='seller_terms' AND (to_jsonb(OLD)-'active') IS DISTINCT FROM (to_jsonb(NEW)-'active') THEN
    RAISE EXCEPTION 'Seller terms are versioned, not mutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_license_template BEFORE UPDATE OR DELETE ON license_template FOR EACH ROW EXECUTE FUNCTION cc_immutable_license();
CREATE TRIGGER immutable_license_certificate BEFORE UPDATE OR DELETE ON license_certificate FOR EACH ROW EXECUTE FUNCTION cc_immutable_license();
CREATE TRIGGER immutable_seller_terms BEFORE UPDATE OR DELETE ON seller_terms FOR EACH ROW EXECUTE FUNCTION cc_immutable_license();

CREATE FUNCTION cc_listing_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE asset asset_type;
BEGIN
  SELECT asset_type INTO STRICT asset FROM catalog_item WHERE id=NEW.item_id;
  IF NOT EXISTS(SELECT 1 FROM channel_eligibility WHERE storefront_id=NEW.storefront_id AND asset_type=asset AND enabled) THEN
    RAISE EXCEPTION 'Asset type is not eligible for this storefront' USING ERRCODE='23514';
  END IF;
  IF NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM category WHERE id=NEW.category_id AND storefront_id=NEW.storefront_id AND enabled) THEN
    RAISE EXCEPTION 'Category belongs to a different or disabled storefront';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_listing BEFORE INSERT OR UPDATE ON channel_listing FOR EACH ROW EXECUTE FUNCTION cc_listing_validate();
CREATE FUNCTION cc_current_version_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM item_version WHERE id=NEW.current_version_id AND item_id=NEW.id) THEN
    RAISE EXCEPTION 'Current version must belong to the canonical item';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER validate_current_version AFTER INSERT OR UPDATE ON catalog_item DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cc_current_version_validate();

CREATE FUNCTION cc_line_currency_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected varchar(3); born xid8;
BEGIN
  SELECT currency INTO STRICT expected FROM ledger_account WHERE id=NEW.ledger_account_id;
  IF expected<>NEW.currency THEN RAISE EXCEPTION 'Ledger account currency mismatch'; END IF;
  SELECT created_xid INTO STRICT born FROM journal WHERE id=NEW.journal_id;
  IF born<>pg_current_xact_id() THEN RAISE EXCEPTION 'A committed journal cannot receive additional lines'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_journal_line BEFORE INSERT ON journal_line FOR EACH ROW EXECUTE FUNCTION cc_line_currency_validate();
CREATE FUNCTION cc_assert_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal_uuid uuid; lines_count bigint; currencies bigint; debits numeric; credits numeric;
BEGIN
  IF TG_TABLE_NAME='journal' THEN journal_uuid := NEW.id;
  ELSE journal_uuid := NEW.journal_id; END IF;
  SELECT count(*),count(DISTINCT currency),coalesce(sum(debit_minor),0),coalesce(sum(credit_minor),0)
    INTO lines_count,currencies,debits,credits FROM journal_line WHERE journal_id=journal_uuid;
  IF lines_count<2 OR currencies<>1 OR debits<>credits THEN
    RAISE EXCEPTION 'Journal % is empty, mixed-currency, or unbalanced',journal_uuid USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON journal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cc_assert_journal();
CREATE CONSTRAINT TRIGGER journal_line_balanced AFTER INSERT ON journal_line DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cc_assert_journal();

CREATE FUNCTION cc_post_journal(p_type text,p_ref text,p_description text,p_currency text,p_entries jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE j uuid; account_uuid uuid; e jsonb; total_debit numeric; total_credit numeric; existing_account ledger_account%ROWTYPE;
BEGIN
  IF p_currency!~'^[A-Z]{3}$' OR jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries)<2 THEN RAISE EXCEPTION 'Invalid journal input'; END IF;
  SELECT sum((value->>'debit')::numeric),sum((value->>'credit')::numeric) INTO total_debit,total_credit FROM jsonb_array_elements(p_entries);
  IF total_debit IS NULL OR total_debit<>total_credit THEN RAISE EXCEPTION 'Unbalanced journal'; END IF;
  INSERT INTO journal(reference_type,reference_id,description) VALUES(p_type,p_ref,p_description)
    ON CONFLICT(reference_type,reference_id) DO NOTHING RETURNING id INTO j;
  IF j IS NULL THEN SELECT id INTO j FROM journal WHERE reference_type=p_type AND reference_id=p_ref; RETURN j; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
    INSERT INTO ledger_account(code,name,type,currency,seller_organisation_id)
      VALUES(e->>'code',e->>'name',(e->>'type')::ledger_account_type,p_currency,(e->>'sellerId')::uuid)
      ON CONFLICT(code) DO NOTHING;
    SELECT * INTO STRICT existing_account FROM ledger_account WHERE code=e->>'code';
    IF existing_account.currency<>p_currency OR existing_account.type::text<>e->>'type' OR existing_account.seller_organisation_id IS DISTINCT FROM (e->>'sellerId')::uuid THEN
      RAISE EXCEPTION 'Existing ledger account configuration mismatch';
    END IF;
    account_uuid:=existing_account.id;
    INSERT INTO journal_line(journal_id,ledger_account_id,debit_minor,credit_minor,currency)
      VALUES(j,account_uuid,(e->>'debit')::bigint,(e->>'credit')::bigint,p_currency);
  END LOOP;
  RETURN j;
END $$;

-- A serialized hash chain detects alteration by the application role. Export a daily
-- signed checkpoint to separate immutable storage to detect privileged DB tampering.
CREATE SEQUENCE audit_event_sequence;
CREATE FUNCTION cc_chain_audit() RETURNS trigger LANGUAGE plpgsql SET timezone='UTC' AS $$
DECLARE previous text;
BEGIN
  PERFORM pg_advisory_xact_lock(728041934);
  SELECT record_hash INTO previous FROM audit_event ORDER BY sequence DESC LIMIT 1;
  NEW.sequence := nextval('audit_event_sequence');
  NEW.previous_hash := coalesce(previous,repeat('0',64));
  NEW.record_hash := encode(digest(convert_to((to_jsonb(NEW)-'record_hash')::text,'UTF8'),'sha256'),'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER chain_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION cc_chain_audit();
CREATE FUNCTION cc_verify_audit() RETURNS TABLE(sequence bigint,valid boolean) LANGUAGE sql STABLE SET timezone='UTC' AS $$
 SELECT a.sequence,
  a.previous_hash=coalesce(lag(a.record_hash) OVER(ORDER BY a.sequence),repeat('0',64))
  AND a.record_hash=encode(digest(convert_to((to_jsonb(a)-'record_hash')::text,'UTF8'),'sha256'),'hex')
 FROM audit_event a ORDER BY a.sequence;
$$;
