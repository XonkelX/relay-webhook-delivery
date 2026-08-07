CREATE TABLE quota_limits (
  id INTEGER PRIMARY KEY
    CHECK (id = 1),

  per_key_daily_events INTEGER NOT NULL
    CHECK (
      per_key_daily_events BETWEEN 1 AND 1000000
    ),

  global_daily_events INTEGER NOT NULL
    CHECK (
      global_daily_events BETWEEN 1 AND 10000000
    ),

  updated_at TEXT NOT NULL,

  CHECK (
    global_daily_events >= per_key_daily_events
  )
);

INSERT INTO quota_limits (
  id,
  per_key_daily_events,
  global_daily_events,
  updated_at
)
VALUES (
  1,
  1000,
  5000,
  CURRENT_TIMESTAMP
);


CREATE TABLE global_daily_usage (
  usage_date TEXT PRIMARY KEY
    CHECK (length(usage_date) = 10),

  accepted_event_count INTEGER NOT NULL DEFAULT 0
    CHECK (accepted_event_count >= 0),

  generated_delivery_count INTEGER NOT NULL DEFAULT 0
    CHECK (generated_delivery_count >= 0),

  payload_bytes INTEGER NOT NULL DEFAULT 0
    CHECK (payload_bytes >= 0),

  updated_at TEXT NOT NULL
);


CREATE TRIGGER enforce_per_key_daily_quota_insert
BEFORE INSERT ON daily_usage
WHEN
  NEW.accepted_event_count >
  COALESCE(
    (
      SELECT per_key_daily_events
      FROM quota_limits
      WHERE id = 1
    ),
    0
  )
BEGIN
  SELECT RAISE(ABORT, 'quota_per_key_daily');
END;


CREATE TRIGGER enforce_per_key_daily_quota_update
BEFORE UPDATE OF accepted_event_count ON daily_usage
WHEN
  NEW.accepted_event_count >
  COALESCE(
    (
      SELECT per_key_daily_events
      FROM quota_limits
      WHERE id = 1
    ),
    0
  )
BEGIN
  SELECT RAISE(ABORT, 'quota_per_key_daily');
END;


CREATE TRIGGER enforce_global_daily_quota_insert
BEFORE INSERT ON global_daily_usage
WHEN
  NEW.accepted_event_count >
  COALESCE(
    (
      SELECT global_daily_events
      FROM quota_limits
      WHERE id = 1
    ),
    0
  )
BEGIN
  SELECT RAISE(ABORT, 'quota_global_daily');
END;


CREATE TRIGGER enforce_global_daily_quota_update
BEFORE UPDATE OF accepted_event_count ON global_daily_usage
WHEN
  NEW.accepted_event_count >
  COALESCE(
    (
      SELECT global_daily_events
      FROM quota_limits
      WHERE id = 1
    ),
    0
  )
BEGIN
  SELECT RAISE(ABORT, 'quota_global_daily');
END;


UPDATE relay_meta
SET value = '9',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
