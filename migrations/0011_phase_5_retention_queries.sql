CREATE INDEX idx_deliveries_replay_source
  ON deliveries (replay_of_delivery_id)
  WHERE replay_of_delivery_id IS NOT NULL;

UPDATE relay_meta
SET value = '11',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
