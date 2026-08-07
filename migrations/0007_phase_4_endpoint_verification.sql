ALTER TABLE endpoints
ADD COLUMN verification_challenge_hash TEXT
  CHECK (
    verification_challenge_hash IS NULL
    OR length(verification_challenge_hash) = 64
  );

ALTER TABLE endpoints
ADD COLUMN verification_expires_at TEXT;

ALTER TABLE endpoints
ADD COLUMN verification_attempted_at TEXT;

CREATE INDEX idx_endpoints_verification
  ON endpoints (status, verification_expires_at);

UPDATE relay_meta
SET value = '7',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
