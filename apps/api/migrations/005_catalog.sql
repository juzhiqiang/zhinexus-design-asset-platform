ALTER TABLE components ADD COLUMN category text NOT NULL DEFAULT 'uncategorized';
ALTER TABLE component_permissions ADD COLUMN can_read boolean NOT NULL DEFAULT false;
CREATE TABLE disabled_subjects (subject text PRIMARY KEY, disabled_at timestamptz NOT NULL DEFAULT now());
-- Shared by the API and independently deployed gateway. NULL means public-only.
CREATE FUNCTION catalog_can_read(component text, actor text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM components c WHERE c.id=component
    AND (actor IS NULL OR NOT EXISTS (SELECT 1 FROM disabled_subjects d WHERE d.subject=actor))
    AND (c.public OR (actor IS NOT NULL AND EXISTS (
      SELECT 1 FROM component_permissions p WHERE p.component_id=c.id AND p.subject=actor
        AND (p.can_read OR p.can_publish OR p.can_maintain)))))
$$;
