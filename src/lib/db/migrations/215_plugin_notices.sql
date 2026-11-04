-- Migration 215: plugin_notices
--
-- Operator-facing notices about an installed plugin that the host cannot satisfy
-- by itself — today only `missing_binary`: the plugin declared a host executable
-- (`requires.binaries`) that is not on PATH inside this container/host.
--
-- Design notes:
-- - `dismissed_at` is the whole point: a notice stays until an operator closes it,
--   and it is NEVER auto-cleared by a timer or by a restart. Re-checking a still
--   missing binary must not resurrect a notice the operator already closed, so the
--   writer upserts on (plugin_name, code, subject) and preserves dismissed_at.
-- - When the binary shows up, the row is deleted, so a later removal raises it
--   again (dismissal applies to the incident, not to the binary forever).
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS plugin_notices (
  id           TEXT PRIMARY KEY,
  plugin_name  TEXT NOT NULL,
  code         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  message      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  dismissed_at TEXT,
  UNIQUE (plugin_name, code, subject)
);

CREATE INDEX IF NOT EXISTS idx_plugin_notices_open
  ON plugin_notices(dismissed_at);

CREATE INDEX IF NOT EXISTS idx_plugin_notices_plugin
  ON plugin_notices(plugin_name);
