CREATE TABLE components (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE component_permissions (
  subject text NOT NULL,
  component_id text NOT NULL REFERENCES components(id),
  can_publish boolean NOT NULL DEFAULT false,
  can_maintain boolean NOT NULL DEFAULT false,
  PRIMARY KEY (subject, component_id)
);
CREATE TABLE variants (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  component_id text NOT NULL REFERENCES components(id),
  framework text NOT NULL CHECK (framework IN ('vue','react')),
  UNIQUE(component_id, framework)
);
CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY,
  subject text NOT NULL,
  client_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('cli','web')),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('OPEN','VERIFYING','COMPLETE','REJECTED')),
  fence bigint NOT NULL DEFAULT 0,
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE upload_files (
  session_id uuid NOT NULL REFERENCES upload_sessions(id),
  path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint NOT NULL CHECK (bytes >= 0 AND bytes <= 524288000),
  object_key text NOT NULL UNIQUE,
  multipart_id text,
  part_count integer NOT NULL DEFAULT 1 CHECK (part_count BETWEEN 1 AND 10000),
  frozen_key text UNIQUE,
  mime_type text,
  verified_at timestamptz,
  PRIMARY KEY(session_id, path)
);
CREATE TABLE release_jobs (
  id uuid PRIMARY KEY,
  subject text NOT NULL,
  client_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('cli','web')),
  upload_session_id uuid NOT NULL REFERENCES upload_sessions(id),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  manifest jsonb NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('UPLOADING','VALIDATING','PENDING','PUBLISHING','READY','REJECTED','RETRY_WAIT','CONFLICT')),
  stage text NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  fencing_token bigint NOT NULL DEFAULT 0,
  lease_until timestamptz,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject, idempotency_key)
);
CREATE TABLE package_releases (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES release_jobs(id),
  name text NOT NULL,
  version text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  metadata jsonb NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','READY')),
  UNIQUE(name, version)
);
CREATE TABLE variant_releases (
  id uuid PRIMARY KEY,
  variant_id text NOT NULL REFERENCES variants(id),
  package_release_id uuid NOT NULL REFERENCES package_releases(id),
  metadata jsonb NOT NULL,
  availability text NOT NULL DEFAULT 'PENDING' CHECK (availability IN ('PENDING','Ready','DEPRECATED')),
  deprecated_reason text,
  UNIQUE(variant_id, package_release_id)
);
CREATE TABLE check_reports (
  id text PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES release_jobs(id),
  variant_id text NOT NULL REFERENCES variants(id),
  content jsonb NOT NULL
);
CREATE TABLE screenshots (
  id text PRIMARY KEY,
  variant_release_id uuid NOT NULL REFERENCES variant_releases(id),
  example_id text NOT NULL,
  environment_key text NOT NULL,
  source text NOT NULL CHECK (source IN ('manual-upload','local-automatic')),
  report_id text REFERENCES check_reports(id),
  object_key text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  metadata jsonb NOT NULL
);
CREATE TABLE baseline_revisions (
  id uuid PRIMARY KEY,
  variant_id text NOT NULL REFERENCES variants(id),
  example_id text NOT NULL,
  environment_key text NOT NULL CHECK (environment_key ~ '^[a-f0-9]{64}$'),
  screenshot_id text NOT NULL REFERENCES screenshots(id),
  parent_revision uuid REFERENCES baseline_revisions(id),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE baseline_heads (
  variant_id text NOT NULL REFERENCES variants(id),
  example_id text NOT NULL,
  environment_key text NOT NULL CHECK (environment_key ~ '^[a-f0-9]{64}$'),
  revision_id uuid REFERENCES baseline_revisions(id),
  PRIMARY KEY(variant_id, example_id, environment_key)
);
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject text,
  event text NOT NULL,
  target_id text NOT NULL,
  request_id text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable history cannot be changed' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON baseline_revisions FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE INDEX release_jobs_pending ON release_jobs(state, created_at);
CREATE INDEX uploads_by_owner ON upload_sessions(subject, created_at);
