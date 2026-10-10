pub(super) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,
  secret_hash BLOB NOT NULL,
  pub BLOB,
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  machine_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token_hash BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (machine_id, device_id)
);
CREATE TABLE IF NOT EXISTS letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS letters_machine ON letters(machine_id, id);
CREATE INDEX IF NOT EXISTS letters_expiry ON letters(created_at);
CREATE TABLE IF NOT EXISTS alert_targets (
  machine_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (machine_id, device_id)
);
";
