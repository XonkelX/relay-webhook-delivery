ALTER TABLE delivery_attempts
  ADD COLUMN lease_token TEXT;

ALTER TABLE delivery_attempts
  ADD COLUMN webhook_id TEXT;

CREATE INDEX idx_delivery_attempts_active_lease
  ON delivery_attempts (delivery_id, lease_token)
  WHERE state = 'started';

UPDATE relay_meta
SET value = '5',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
