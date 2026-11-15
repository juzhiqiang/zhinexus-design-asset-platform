CREATE TABLE search_documents (
  variant_release_id uuid PRIMARY KEY REFERENCES variant_releases(id),
  revision text NOT NULL CHECK (revision ~ '^[a-f0-9]{64}$'),
  provider_version text NOT NULL,
  body text NOT NULL,
  document tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
  indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_documents_text_idx ON search_documents USING gin(document);
ALTER TABLE release_outbox ADD COLUMN search_attempted_at timestamptz;
