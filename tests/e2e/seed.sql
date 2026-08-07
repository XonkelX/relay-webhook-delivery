PRAGMA foreign_keys = ON;

DELETE FROM delivery_attempts
WHERE delivery_id = 'dlv_e2econsole01';

DELETE FROM delivery_outbox
WHERE delivery_id = 'dlv_e2econsole01';

DELETE FROM deliveries
WHERE id = 'dlv_e2econsole01';

DELETE FROM events
WHERE id = 'evt_e2econsole01';

DELETE FROM endpoint_subscriptions
WHERE endpoint_id = 'ep_e2econsole01';

DELETE FROM endpoints
WHERE id = 'ep_e2econsole01';

DELETE FROM api_keys
WHERE id = 'key_e2econsole01';

INSERT INTO api_keys (
  id,
  name,
  key_prefix,
  secret_hash,
  status,
  created_at
)
VALUES (
  'key_e2econsole01',
  'E2E console key',
  'rlye2e0001',
  lower(hex(randomblob(32))),
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
);

INSERT INTO endpoints (
  id,
  name,
  url,
  status,
  created_at,
  updated_at,
  verified_at
)
VALUES (
  'ep_e2econsole01',
  'E2E Receiver',
  'https://e2e.example.test/webhook',
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
);

INSERT INTO endpoint_subscriptions (
  endpoint_id,
  event_type,
  created_at
)
VALUES (
  'ep_e2econsole01',
  'invoice.payment_failed',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
);

INSERT INTO events (
  id,
  api_key_id,
  idempotency_key,
  event_type,
  payload_json,
  payload_sha256,
  payload_bytes,
  created_at
)
VALUES (
  'evt_e2econsole01',
  'key_e2econsole01',
  'e2e-console-event',
  'invoice.payment_failed',
  '{}',
  lower(hex(randomblob(32))),
  2,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')
);

INSERT INTO deliveries (
  id,
  event_id,
  endpoint_id,
  status,
  attempt_count,
  next_attempt_at,
  created_at,
  updated_at,
  delivered_at,
  exhausted_at
)
VALUES (
  'dlv_e2econsole01',
  'evt_e2econsole01',
  'ep_e2econsole01',
  'delivered',
  3,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute'),
  NULL
);

INSERT INTO delivery_attempts (
  id,
  delivery_id,
  attempt_no,
  state,
  outcome,
  request_started_at,
  completed_at,
  status_code,
  latency_ms,
  error_class,
  response_excerpt,
  created_at,
  lease_token,
  webhook_id
)
VALUES
(
  'att_e2econsole01',
  'dlv_e2econsole01',
  1,
  'completed',
  'transient_failure',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 minutes'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 minutes', '+0.200 seconds'),
  503,
  200,
  'http_503',
  'upstream unavailable',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 minutes'),
  'lease_e2econsole01',
  'msg_e2econsole01'
),
(
  'att_e2econsole02',
  'dlv_e2econsole01',
  2,
  'completed',
  'transient_failure',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes', '+0.180 seconds'),
  503,
  180,
  'http_503',
  'still unavailable',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 minutes'),
  'lease_e2econsole02',
  'msg_e2econsole01'
),
(
  'att_e2econsole03',
  'dlv_e2econsole01',
  3,
  'completed',
  'success',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute', '+0.125 seconds'),
  200,
  125,
  NULL,
  'ok',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute'),
  'lease_e2econsole03',
  'msg_e2econsole01'
);

