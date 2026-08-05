CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY CHECK (id GLOB 'att_*'),
  delivery_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),

  state TEXT NOT NULL DEFAULT 'started'
    CHECK (state IN ('started', 'completed')),

  outcome TEXT
    CHECK (
      outcome IS NULL
      OR outcome IN (
        'success',
        'transient_failure',
        'permanent_failure',
        'timeout',
        'network_error'
      )
    ),

  request_started_at TEXT NOT NULL,
  completed_at TEXT,

  status_code INTEGER
    CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),

  latency_ms INTEGER
    CHECK (latency_ms IS NULL OR latency_ms >= 0),

  error_class TEXT,
  response_headers_json TEXT,
  response_excerpt TEXT,

  created_at TEXT NOT NULL,

  FOREIGN KEY (delivery_id)
    REFERENCES deliveries (id)
    ON DELETE RESTRICT,

  UNIQUE (delivery_id, attempt_no),

  CHECK (
    (state = 'started' AND outcome IS NULL AND completed_at IS NULL)
    OR
    (state = 'completed' AND outcome IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_delivery_attempts_delivery
  ON delivery_attempts (delivery_id, attempt_no);


CREATE TABLE audit_log (
  id TEXT PRIMARY KEY CHECK (id GLOB 'aud_*'),

  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('owner', 'api_key', 'system')),

  actor_id TEXT,

  action TEXT NOT NULL
    CHECK (length(action) BETWEEN 1 AND 120),

  target_type TEXT NOT NULL
    CHECK (length(target_type) BETWEEN 1 AND 80),

  target_id TEXT,

  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_log_created
  ON audit_log (created_at DESC, id DESC);

CREATE INDEX idx_audit_log_target
  ON audit_log (target_type, target_id, created_at DESC);


UPDATE relay_meta
SET value = '4',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
