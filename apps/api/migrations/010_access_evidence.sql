-- Existing status flags are intentionally not migrated into fresh login evidence.
ALTER TABLE access_revisions ADD COLUMN check_evidence jsonb NOT NULL DEFAULT '{}';
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON access_audit FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON access_activations FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE FUNCTION protect_access_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.id <> OLD.id OR NEW.section <> OLD.section OR NEW.config <> OLD.config OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'access revision identity and configuration are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_config BEFORE UPDATE OR DELETE ON access_revisions FOR EACH ROW EXECUTE FUNCTION protect_access_revision();
