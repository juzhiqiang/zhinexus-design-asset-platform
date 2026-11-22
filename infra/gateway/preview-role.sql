-- Run after migrations as the deployment DBA; create preview_reader and inject its credential separately.
GRANT SELECT ON components, component_permissions, disabled_subjects, variants,
  variant_releases, package_releases, release_jobs, release_artifacts,
  preview_grants, preview_sessions, access_active, access_revisions,
  subject_role_restrictions TO preview_reader;
GRANT UPDATE (redeemed_at) ON preview_grants TO preview_reader;
GRANT UPDATE (gateway_generation) ON access_active TO preview_reader;
GRANT INSERT ON preview_sessions TO preview_reader;
GRANT INSERT ON audit_events TO preview_reader;
GRANT USAGE ON SEQUENCE audit_events_id_seq TO preview_reader;
GRANT EXECUTE ON FUNCTION catalog_can_read(text,text), preview_can_read(uuid,text) TO preview_reader;
