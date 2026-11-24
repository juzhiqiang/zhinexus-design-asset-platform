ALTER TABLE oidc_attempts
  ADD COLUMN web_target text NOT NULL DEFAULT 'gallery'
  CHECK (web_target IN ('gallery', 'admin'));

UPDATE oidc_attempts SET web_target = 'admin' WHERE candidate;
