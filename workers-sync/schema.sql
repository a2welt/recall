CREATE TABLE IF NOT EXISTS inboxes (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS captures (
  id TEXT NOT NULL,
  inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (inbox_id, id)
);

CREATE INDEX IF NOT EXISTS idx_captures_inbox_received ON captures(inbox_id, received_at);

CREATE TABLE IF NOT EXISTS snapshots (
  inbox_id TEXT PRIMARY KEY REFERENCES inboxes(id) ON DELETE CASCADE,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  encoding TEXT NOT NULL DEFAULT 'gzip+json',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
