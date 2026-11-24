-- Local identity service: password material, authorization codes and signing keys.
--
-- This migration retires an invariant recorded in 012_managed_accounts.sql:
--   "Credentials live only in the identity service; this migration stores no password material."
-- That statement no longer holds. The platform is now its own identity service (see
-- component-platform-implementation-assessment.md section 12), so password hashes, authorization
-- codes and the JWT signing key all live in this database. The tradeoff is explicit and accepted:
-- the API process both stores credentials and signs tokens, so a single compromise can forge
-- tokens for any account. Short token lifetime and key rotation are the only mitigations in this
-- round; login throttling and account lockout are deferred and are NOT claimed as mitigations.
--
-- Private keys are stored as plaintext PEM at rest. Database access is already restricted to the
-- API; key rotation bounds the exposure window. Encryption at rest with an external KMS is the
-- documented upgrade path and is not implemented here.

-- One credential row per managed account. `remote_user_id` in managed_accounts is the account id
-- itself for the local identity service, so no separate mapping is needed.
CREATE TABLE local_credentials (
  account_id uuid PRIMARY KEY REFERENCES managed_accounts(id) ON DELETE CASCADE,
  -- scrypt digest in the form scrypt$N$r$p$keylen$salt$hash; never a plaintext or reversible value.
  password_hash text NOT NULL,
  -- First login must replace the platform-issued temporary credential.
  must_change boolean NOT NULL DEFAULT true,
  credentials_set_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Authorization codes are single-use, short-lived and bound to client, redirect URI and the PKCE
-- challenge the caller presented. `code_hash` is the primary key so a leaked table cannot be
-- replayed: only the holder of the original code can consume it.
CREATE TABLE local_authorization_codes (
  code_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES managed_accounts(id) ON DELETE CASCADE,
  client_id text NOT NULL CHECK (client_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 1 AND 2048),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  -- Signed claim values captured at issuance so a later account change cannot be smuggled in.
  account_version bigint NOT NULL CHECK (account_version >= 0),
  auth_time bigint NOT NULL CHECK (auth_time >= 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX local_authorization_codes_live ON local_authorization_codes(expires_at) WHERE consumed_at IS NULL;

-- Signing keys. Exactly one row is active at a time; retired keys stay published in JWKS until
-- every token they signed has expired, then may be deleted.
CREATE TABLE local_signing_keys (
  kid text PRIMARY KEY CHECK (kid ~ '^[A-Za-z0-9_-]{8,64}$'),
  public_jwk jsonb NOT NULL,
  private_pem text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz
);
CREATE UNIQUE INDEX local_signing_keys_single_active ON local_signing_keys((state)) WHERE state = 'active';
