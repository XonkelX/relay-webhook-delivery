CREATE TABLE api_keys (
  id TEXT PRIMARY KEY CHECK (id GLOB 'key_*'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  key_prefix TEXT NOT NULL UNIQUE CHECK (length(key_prefix) BETWEEN 8 AND 24),
  secret_hash TEXT NOT NULL UNIQUE CHECK (length(secret_hash) = 64),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX idx_api_keys_status
  ON api_keys (status);

CREATE TABLE owner_sessions (
  id TEXT PRIMARY KEY CHECK (id GLOB 'ses_*'),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE INDEX idx_owner_sessions_expiry
  ON owner_sessions (expires_at);

CREATE TABLE endpoints (
  id TEXT PRIMARY KEY CHECK (id GLOB 'ep_*'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  url TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'paused', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  verified_at TEXT,
  disabled_at TEXT,
  CHECK (status != 'active' OR verified_at IS NOT NULL),
  CHECK (status != 'disabled' OR disabled_at IS NOT NULL)
);

CREATE INDEX idx_endpoints_status
  ON endpoints (status);

CREATE TABLE endpoint_subscriptions (
  endpoint_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  PRIMARY KEY (endpoint_id, event_type),
  FOREIGN KEY (endpoint_id)
    REFERENCES endpoints (id)
    ON DELETE CASCADE
);

CREATE INDEX idx_endpoint_subscriptions_event
  ON endpoint_subscriptions (event_type, endpoint_id);

UPDATE relay_meta
SET value = '2',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
