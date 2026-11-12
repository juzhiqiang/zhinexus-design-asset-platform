ALTER TABLE release_jobs ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0);
ALTER TABLE release_jobs ADD COLUMN next_attempt_at timestamptz;
ALTER TABLE release_jobs ADD COLUMN missing_artifacts jsonb NOT NULL DEFAULT '[]';
CREATE INDEX release_jobs_due ON release_jobs(state, next_attempt_at, lease_until);

CREATE TABLE release_artifacts (
  job_id uuid NOT NULL REFERENCES release_jobs(id),
  path text NOT NULL,
  object_key text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint NOT NULL CHECK (bytes >= 0),
  PRIMARY KEY(job_id, path)
);
CREATE TABLE release_outbox (
  job_id uuid PRIMARY KEY REFERENCES release_jobs(id),
  topic text NOT NULL CHECK (topic = 'RELEASE_READY'),
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','indexed','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE release_tags (
  name text PRIMARY KEY,
  package_release_id uuid NOT NULL REFERENCES package_releases(id),
  generation bigint NOT NULL DEFAULT 1,
  applied_generation bigint NOT NULL DEFAULT 0,
  attempt integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
