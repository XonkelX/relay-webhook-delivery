ALTER TABLE delivery_outbox
  ADD COLUMN reason TEXT NOT NULL DEFAULT 'initial'
    CHECK (reason IN ('initial', 'retry', 'replay'));

UPDATE relay_meta
SET value = '6',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
