CREATE TABLE preview_grants (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  subject text NOT NULL,
  variant_release_id uuid NOT NULL REFERENCES variant_releases(id),
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX preview_grants_expiry ON preview_grants(expires_at);
CREATE TABLE preview_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  grant_hash text NOT NULL UNIQUE REFERENCES preview_grants(token_hash) ON DELETE CASCADE
);
CREATE FUNCTION preview_can_read(release uuid, actor text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM variant_releases vr JOIN variants v ON v.id=vr.variant_id
    JOIN package_releases p ON p.id=vr.package_release_id JOIN release_jobs j ON j.id=p.job_id
    WHERE vr.id=release AND vr.availability='Ready' AND p.state='READY' AND j.state='READY'
      AND catalog_can_read(v.component_id,actor))
$$;
