CREATE TABLE access_revisions (
  id uuid PRIMARY KEY, section text NOT NULL CHECK (section IN ('oidc','preview')),
  config jsonb NOT NULL, checks jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), checked_at timestamptz
);
CREATE TABLE access_active (
  section text PRIMARY KEY CHECK (section IN ('oidc','preview')),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  active_revision_id uuid REFERENCES access_revisions(id), draft_revision_id uuid REFERENCES access_revisions(id),
  gateway_generation bigint
);
INSERT INTO access_active(section) VALUES ('oidc'),('preview');
CREATE TABLE access_audit (
  id bigserial PRIMARY KEY, section text NOT NULL, action text NOT NULL, revision uuid NOT NULL,
  actor text NOT NULL, result text NOT NULL, generation bigint NOT NULL, checks jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE access_activations (
  section text NOT NULL, generation bigint NOT NULL, revision uuid NOT NULL REFERENCES access_revisions(id),
  PRIMARY KEY(section,generation)
);
CREATE TABLE oidc_attempts (
  state_hash text PRIMARY KEY, browser_hash text NOT NULL, revision uuid REFERENCES access_revisions(id),
  generation bigint NOT NULL, candidate boolean NOT NULL, verifier text NOT NULL, nonce text NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE oidc_sessions (
  token_hash text PRIMARY KEY, generation bigint NOT NULL, issuer text NOT NULL, identity_subject text NOT NULL,
  principal jsonb NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE identity_bindings (
  issuer text NOT NULL, identity_subject text NOT NULL, platform_subject text NOT NULL UNIQUE,
  PRIMARY KEY(issuer,identity_subject)
);
CREATE TABLE subject_role_restrictions (
  subject text NOT NULL, role text NOT NULL CHECK(role IN ('reader','publisher','maintainer')),
  PRIMARY KEY(subject,role)
);
ALTER TABLE preview_grants ADD COLUMN preview_generation bigint NOT NULL DEFAULT 0;
ALTER TABLE preview_grants ADD COLUMN oidc_generation bigint NOT NULL DEFAULT 0;
