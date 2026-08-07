CREATE TABLE endpoint_signing_secrets (
  endpoint_id TEXT NOT NULL,
  generation INTEGER NOT NULL
    CHECK (generation >= 1),
  state TEXT NOT NULL
    CHECK (state IN ('active', 'previous')),
  key_version TEXT NOT NULL
    CHECK (length(trim(key_version)) BETWEEN 1 AND 40),
  iv_base64 TEXT NOT NULL
    CHECK (length(iv_base64) = 16),
  ciphertext_base64 TEXT NOT NULL
    CHECK (length(ciphertext_base64) BETWEEN 32 AND 512),
  valid_until TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (endpoint_id, generation),
  FOREIGN KEY (endpoint_id)
    REFERENCES endpoints (id)
    ON DELETE CASCADE,
  CHECK (
    (state = 'active' AND valid_until IS NULL)
    OR
    (state = 'previous' AND valid_until IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_endpoint_signing_secrets_active
  ON endpoint_signing_secrets (endpoint_id)
  WHERE state = 'active';

CREATE INDEX idx_endpoint_signing_secrets_previous_expiry
  ON endpoint_signing_secrets (valid_until)
  WHERE state = 'previous';

UPDATE relay_meta
SET value = '8',
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
