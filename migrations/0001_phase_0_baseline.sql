CREATE TABLE IF NOT EXISTS relay_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO relay_meta (key, value)
VALUES ('schema_version', '0');
