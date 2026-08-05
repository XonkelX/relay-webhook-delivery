CREATE TABLE events (
  id TEXT PRIMARY KEY CHECK (id GLOB 'evt_*'),
  api_key_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL
    CHECK (length(event_type) BETWEEN 1 AND 120),
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL
    CHECK (length(payload_sha256) = 64),
  payload_bytes INTEGER NOT NULL
    CHECK (payload_bytes >= 0),
  created_at TEXT NOT NULL,

  FOREIGN KEY (api_key_id)
    REFERENCES api_keys (id)
    ON DELETE RESTRICT,

  UNIQUE (api_key_id, idempotency_key)
);

CREATE INDEX idx_events_created
  ON events (created_at DESC, id DESC);

CREATE INDEX idx_events_type_created
  ON events (event_type, created_at DESC);


CREATE TABLE deliveries (
  id TEXT PRIMARY KEY CHECK (id GLOB 'dlv_*'),
  event_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (
      status IN (
        'queued',
        'leased',
        'retrying',
        'delivered',
        'exhausted',
        'cancelled'
      )
    ),

  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),

  next_attempt_at TEXT NOT NULL,

  lease_token TEXT,
  lease_expires_at TEXT,

  replay_of_delivery_id TEXT,

  last_error_class TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  exhausted_at TEXT,

  FOREIGN KEY (event_id)
    REFERENCES events (id)
    ON DELETE RESTRICT,

  FOREIGN KEY (endpoint_id)
    REFERENCES endpoints (id)
    ON DELETE RESTRICT,

  FOREIGN KEY (replay_of_delivery_id)
    REFERENCES deliveries (id)
    ON DELETE RESTRICT,

  CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR
    (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),

  CHECK (
    status != 'delivered'
    OR delivered_at IS NOT NULL
  ),

  CHECK (
    status != 'exhausted'
    OR exhausted_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX idx_deliveries_initial_unique
  ON deliveries (event_id, endpoint_id)
  WHERE replay_of_delivery_id IS NULL;

CREATE INDEX idx_deliveries_event
  ON deliveries (event_id, created_at);

CREATE INDEX idx_deliveries_endpoint_status
  ON deliveries (endpoint_id, status, next_attempt_at);

CREATE INDEX idx_deliveries_scheduler
  ON deliveries (status, next_attempt_at);


CREATE TABLE delivery_outbox (
  id TEXT PRIMARY KEY CHECK (id GLOB 'out_*'),
  delivery_id TEXT NOT NULL UNIQUE,

  available_at TEXT NOT NULL,
  published_at TEXT,

  publish_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (publish_attempts >= 0),

  last_error TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY (delivery_id)
    REFERENCES deliveries (id)
    ON DELETE CASCADE
);

CREATE INDEX idx_delivery_outbox_pending
  ON delivery_outbox (available_at, created_at)
  WHERE published_at IS NULL;


CREATE TABLE daily_usage (
  api_key_id TEXT NOT NULL,
  usage_date TEXT NOT NULL
    CHECK (length(usage_date) = 10),

  accepted_event_count INTEGER NOT NULL DEFAULT 0
    CHECK (accepted_event_count >= 0),

  generated_delivery_count INTEGER NOT NULL DEFAULT 0
    CHECK (generated_delivery_count >= 0),

  payload_bytes INTEGER NOT NULL DEFAULT 0
    CHECK (payload_bytes >= 0),

  updated_at TEXT NOT NULL,

  PRIMARY KEY (api_key_id, usage_date),

  FOREIGN KEY (api_key_id)
    REFERENCES api_keys (id)
    ON DELETE RESTRICT
);


UPDATE relay_meta
SET value = '3',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
