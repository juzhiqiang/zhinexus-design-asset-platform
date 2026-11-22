-- Self-managed account directory, grants and identity operation log.
-- Credentials live only in the identity service; this migration stores no password material.
CREATE TABLE managed_accounts (
  id uuid PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  platform_subject text NOT NULL UNIQUE,
  username text NOT NULL CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,64}$'),
  display_name text NOT NULL CHECK (display_name ~ '^\S(.*\S)?$' AND length(display_name) <= 64),
  roles text[] NOT NULL DEFAULT '{}' CHECK (roles <@ ARRAY['reader','publisher','maintainer']::text[] AND cardinality(roles) BETWEEN 1 AND 3),
  administrator boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  awaiting_activation boolean NOT NULL DEFAULT true,
  credentials_set boolean NOT NULL DEFAULT false,
  credential_uncertain boolean NOT NULL DEFAULT false,
  sync_state text NOT NULL DEFAULT 'pending' CHECK (sync_state IN ('pending','syncing','synced','failed')),
  remote_user_id text,
  desired_revision bigint NOT NULL DEFAULT 0 CHECK (desired_revision >= 0),
  access_epoch bigint NOT NULL DEFAULT 0 CHECK (access_epoch >= 0),
  auth_time_floor bigint NOT NULL DEFAULT 0 CHECK (auth_time_floor >= 0),
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);
-- Uniqueness is per identity source and per normalized username; legacy subjects are never adopted by name.
CREATE UNIQUE INDEX managed_accounts_identity_key ON managed_accounts(issuer, subject);
CREATE UNIQUE INDEX managed_accounts_username_key ON managed_accounts(issuer, username);
CREATE INDEX managed_accounts_enabled_key ON managed_accounts(enabled, username);

CREATE TABLE managed_account_component_grants (
  account_id uuid NOT NULL REFERENCES managed_accounts(id) ON DELETE CASCADE,
  component_id text NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  can_publish boolean NOT NULL DEFAULT false,
  can_maintain boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, component_id),
  CHECK (can_publish OR can_maintain)
);
CREATE TABLE managed_account_package_grants (
  account_id uuid NOT NULL REFERENCES managed_accounts(id) ON DELETE CASCADE,
  package_name text NOT NULL CHECK (package_name ~ '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$'),
  PRIMARY KEY (account_id, package_name)
);

-- Persistent identity operations, coordinated separately from release_jobs.
-- The payload never carries a password; password setting is a transient protected request.
CREATE TABLE identity_operations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES managed_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('create','update','enable','disable','force-logout')),
  desired_revision bigint NOT NULL CHECK (desired_revision >= 0),
  account_version bigint NOT NULL CHECK (account_version >= 0),
  payload jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed','uncertain')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- One in-flight operation per account: the identity service is serialized per subject.
CREATE UNIQUE INDEX identity_operations_active_account ON identity_operations(account_id) WHERE state IN ('queued','running');
CREATE INDEX identity_operations_queue ON identity_operations(created_at) WHERE state IN ('queued','running');

-- Sessions and preview authorisations remember the account version they were issued for.
ALTER TABLE oidc_sessions ADD COLUMN account_version bigint;
ALTER TABLE oidc_sessions ADD COLUMN auth_time bigint;
ALTER TABLE oidc_start_tickets ADD COLUMN account_version bigint;
ALTER TABLE preview_grants ADD COLUMN account_version bigint;
