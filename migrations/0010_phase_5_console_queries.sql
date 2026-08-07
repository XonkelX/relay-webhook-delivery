CREATE INDEX idx_events_type_created_cursor
  ON events (
    event_type,
    created_at DESC,
    id DESC
  );

CREATE INDEX idx_deliveries_status_event
  ON deliveries (
    status,
    event_id
  );

CREATE INDEX idx_deliveries_endpoint_created
  ON deliveries (
    endpoint_id,
    created_at DESC,
    id DESC
  );

CREATE INDEX idx_delivery_attempts_completed
  ON delivery_attempts (
    completed_at DESC,
    id DESC
  )
  WHERE state = 'completed';

UPDATE relay_meta
SET value = '10',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
