-- Allow anonymous short-lived preview grants for public Ready components only.
ALTER TABLE preview_grants ALTER COLUMN subject DROP NOT NULL;
ALTER TABLE preview_grants ADD CONSTRAINT preview_grants_anonymous_shape
  CHECK (subject IS NOT NULL OR (cardinality(read_roles) = 0 AND account_version IS NULL));
