CREATE TABLE component_categories (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 128 AND name=btrim(name) AND length(btrim(name))>0),
  enabled boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Existing category text and immutable release snapshots remain readable; administration only disables.
CREATE TRIGGER retain_category BEFORE DELETE ON component_categories FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
