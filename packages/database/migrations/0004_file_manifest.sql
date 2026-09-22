-- A submission cannot have originals silently appended after the immutable release was submitted.
CREATE FUNCTION cc_guard_file_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state item_status;
BEGIN
 SELECT status INTO state FROM item_version WHERE id=NEW.item_version_id FOR UPDATE;
 IF NEW.role IN ('PREVIEW','MANIFEST') THEN
   IF state NOT IN ('DRAFT','SCANNING','PROCESSING') THEN RAISE EXCEPTION 'generated files may only be added while processing'; END IF;
 ELSIF state<>'DRAFT' THEN RAISE EXCEPTION 'submitted version manifest is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER file_manifest_insert BEFORE INSERT ON file_object FOR EACH ROW EXECUTE FUNCTION cc_guard_file_insert();
CREATE UNIQUE INDEX one_live_upload_per_version ON upload_session(item_version_id) WHERE status IN('UPLOADING','FINALIZED');
CREATE UNIQUE INDEX one_file_client_id_per_session ON file_object(upload_session_id,client_file_id) WHERE client_file_id IS NOT NULL;
