-- Client evidence references are unique within a release bundle, not across versions.
-- migrateRegistry runs this entire migration in a transaction under its advisory lock.
LOCK TABLE check_reports, screenshots, baseline_revisions IN ACCESS EXCLUSIVE MODE;
ALTER TABLE screenshots DROP CONSTRAINT screenshots_report_id_fkey;
ALTER TABLE baseline_revisions DROP CONSTRAINT baseline_revisions_screenshot_id_fkey;

ALTER TABLE check_reports RENAME COLUMN id TO client_ref;
ALTER TABLE check_reports ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE check_reports DROP CONSTRAINT check_reports_pkey;
ALTER TABLE check_reports ADD PRIMARY KEY (id);
ALTER TABLE check_reports ADD UNIQUE (job_id, client_ref);

ALTER TABLE screenshots RENAME COLUMN id TO client_ref;
ALTER TABLE screenshots ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE screenshots ADD COLUMN job_id uuid;
UPDATE screenshots s SET job_id=pr.job_id
  FROM variant_releases vr JOIN package_releases pr ON pr.id=vr.package_release_id
  WHERE vr.id=s.variant_release_id;
ALTER TABLE screenshots ALTER COLUMN job_id SET NOT NULL;
ALTER TABLE screenshots ADD FOREIGN KEY (job_id) REFERENCES release_jobs(id);
ALTER TABLE screenshots DROP CONSTRAINT screenshots_pkey;
ALTER TABLE screenshots ADD PRIMARY KEY (id);
ALTER TABLE screenshots ADD UNIQUE (job_id, client_ref);
UPDATE screenshots s SET report_id=r.id::text FROM check_reports r WHERE r.client_ref=s.report_id;
ALTER TABLE screenshots ALTER COLUMN report_id TYPE uuid USING report_id::uuid;
ALTER TABLE screenshots ADD FOREIGN KEY (report_id) REFERENCES check_reports(id);

-- Only the stored FK representation changes; immutable evidence JSON and revision history remain intact.
ALTER TABLE baseline_revisions DISABLE TRIGGER immutable_rows;
UPDATE baseline_revisions b SET screenshot_id=s.id::text FROM screenshots s WHERE s.client_ref=b.screenshot_id;
ALTER TABLE baseline_revisions ALTER COLUMN screenshot_id TYPE uuid USING screenshot_id::uuid;
ALTER TABLE baseline_revisions ADD FOREIGN KEY (screenshot_id) REFERENCES screenshots(id);
ALTER TABLE baseline_revisions ENABLE TRIGGER immutable_rows;
