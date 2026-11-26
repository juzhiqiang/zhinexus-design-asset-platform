-- Allow read-only per-component grants on self-managed member accounts.
ALTER TABLE managed_account_component_grants
  ADD COLUMN can_read boolean NOT NULL DEFAULT false;

ALTER TABLE managed_account_component_grants
  DROP CONSTRAINT managed_account_component_grants_check,
  ADD CONSTRAINT managed_account_component_grants_check CHECK (can_read OR can_publish OR can_maintain);
