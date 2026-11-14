CREATE TABLE compatibility_evidences (
  id uuid PRIMARY KEY,
  variant_release_id uuid NOT NULL REFERENCES variant_releases(id),
  package_release_id uuid NOT NULL REFERENCES package_releases(id),
  package_name text NOT NULL,
  package_version text NOT NULL,
  package_sha256 text NOT NULL CHECK (package_sha256 ~ '^[a-f0-9]{64}$'),
  framework text NOT NULL CHECK (framework IN ('vue', 'react')),
  framework_version text NOT NULL,
  echarts_version text NOT NULL,
  candidate_integrity text NOT NULL,
  candidate_source text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed')),
  evidence jsonb NOT NULL,
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_release_id, echarts_version)
);
CREATE INDEX compatibility_evidences_release_idx ON compatibility_evidences(variant_release_id, created_at DESC);
