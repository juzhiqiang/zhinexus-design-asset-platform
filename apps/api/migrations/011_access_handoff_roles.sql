CREATE TABLE oidc_start_tickets (
  token_hash text PRIMARY KEY, revision uuid NOT NULL REFERENCES access_revisions(id),
  generation bigint NOT NULL, subject text NOT NULL, issuer text NOT NULL, identity_subject text NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);
-- Old grants have no role provenance and must be requested again.
ALTER TABLE preview_grants ADD COLUMN read_roles text[] NOT NULL DEFAULT '{}';
ALTER TABLE preview_grants ADD CONSTRAINT valid_read_roles CHECK (read_roles <@ ARRAY['reader','publisher','maintainer']::text[] AND cardinality(read_roles) <= 3);
