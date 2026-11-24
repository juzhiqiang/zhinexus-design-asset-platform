/** Ordered runtime migrations; packaging checks consume this same data-only list. */
export const registryMigrationFiles = [
  '001_registry.sql', '002_package_permissions.sql', '003_evidence_references.sql',
  '004_release_worker.sql', '005_catalog.sql', '006_preview.sql', '007_compatibility.sql', '008_search.sql', '009_access_settings.sql', '010_access_evidence.sql', '011_access_handoff_roles.sql', '012_managed_accounts.sql', '013_local_credentials.sql', '014_web_login_target.sql', '015_component_categories.sql',
] as const;
