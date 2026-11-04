-- Migration 214: plugin_resources
--
-- Numbered 214, not 213: 213 is already taken by api_key_preferred_connections
-- on databases that ran a build past v3.8.52. The runner skips by version only,
-- so a 213 here would silently never run and every activation would fail to
-- record ownership.
--
-- Ownership ledger for host resources a plugin asked the host to materialise.
--
-- A plugin declares provider nodes (and, later, other host resources) in its
-- manifest `contributes` block. The host writes the rows itself, then records
-- one row here per materialised resource so deactivation can reclaim exactly
-- what that plugin created — and nothing else.
--
-- kind is intentionally NOT constrained by a CHECK: new resource kinds are
-- expected to appear alongside new contribution types, and the writer is the
-- only producer (values are validated in src/lib/plugins/manager.ts).
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS plugin_resources (
  plugin_name  TEXT NOT NULL,
  kind         TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (plugin_name, kind, resource_key)
);

CREATE INDEX IF NOT EXISTS idx_plugin_resources_plugin
  ON plugin_resources(plugin_name);

CREATE INDEX IF NOT EXISTS idx_plugin_resources_kind_key
  ON plugin_resources(kind, resource_key);
