/**
 * Plugin notices DB module.
 *
 * A notice is an operator-facing fact about an installed plugin that the host
 * cannot fix on its own — today only "this plugin needs a host binary that is not
 * installed". Notices live in the DB (not in memory) so they survive a container
 * restart, and `dismissed_at` makes closing one an explicit, permanent act:
 * nothing here ever expires a notice on its own.
 *
 * @module db/pluginNotices
 */

import { randomUUID } from "node:crypto";
import { getDbInstance } from "./core";
import { logger } from "../../../open-sse/utils/logger.ts";

const log = logger("DB_PLUGIN_NOTICES");

export type PluginNoticeCode = "missing_binary";

export interface PluginNoticeRow {
  id: string;
  pluginName: string;
  code: PluginNoticeCode;
  /** The thing the notice is about (a binary name, for `missing_binary`). */
  subject: string;
  message: string;
  createdAt: string;
  dismissedAt: string | null;
}

export interface PluginNoticeInput {
  pluginName: string;
  code: PluginNoticeCode;
  subject: string;
  message: string;
}

function rowToNotice(row: any): PluginNoticeRow {
  return {
    id: row.id,
    pluginName: row.plugin_name,
    code: row.code,
    subject: row.subject,
    message: row.message,
    createdAt: row.created_at,
    dismissedAt: row.dismissed_at,
  };
}

/**
 * Record a notice, or refresh its text when it already exists.
 *
 * `dismissed_at` is deliberately absent from the UPDATE clause: an operator who
 * closed this notice for this plugin+binary must not see it come back the next
 * time the plugin is reactivated or the container restarts.
 */
export function upsertPluginNotice(input: PluginNoticeInput): void {
  const db = getDbInstance();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO plugin_notices (id, plugin_name, code, subject, message, created_at, dismissed_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(plugin_name, code, subject)
     DO UPDATE SET message = excluded.message`
  ).run(randomUUID(), input.pluginName, input.code, input.subject, input.message, now);
  log.info("notice.upserted", {
    plugin: input.pluginName,
    code: input.code,
    subject: input.subject,
  });
}

/** Open notices (dismissed ones are hidden by default), newest first. */
export function listPluginNotices(options: { includeDismissed?: boolean } = {}): PluginNoticeRow[] {
  const db = getDbInstance();
  const sql = options.includeDismissed
    ? "SELECT * FROM plugin_notices ORDER BY created_at DESC"
    : "SELECT * FROM plugin_notices WHERE dismissed_at IS NULL ORDER BY created_at DESC";
  return db.prepare(sql).all().map(rowToNotice);
}

export function getPluginNotice(id: string): PluginNoticeRow | null {
  const db = getDbInstance();
  const row = db.prepare("SELECT * FROM plugin_notices WHERE id = ?").get(id);
  return row ? rowToNotice(row as any) : null;
}

/**
 * Close a notice for good.
 *
 * A soft close on purpose: every activation (including the boot-time reload of the
 * plugins that are still active) re-probes PATH, and the binary is still missing, so
 * a hard DELETE would let the next upsert re-create the row and the operator would
 * see the same warning again after every restart.
 *
 * Returns false when the id is unknown or already dismissed, so the route can answer
 * 404 instead of pretending it worked.
 */
export function dismissPluginNotice(id: string): boolean {
  const db = getDbInstance();
  const result = db
    .prepare("UPDATE plugin_notices SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL")
    .run(new Date().toISOString(), id);
  return result.changes > 0;
}

/**
 * Forget one notice because its cause is gone (the binary was installed).
 * Deleting rather than marking dismissed is what lets a future removal raise the
 * notice again — the operator dismissed an incident, not the binary forever.
 */
export function clearPluginNotice(
  pluginName: string,
  code: PluginNoticeCode,
  subject: string
): boolean {
  const db = getDbInstance();
  const result = db
    .prepare("DELETE FROM plugin_notices WHERE plugin_name = ? AND code = ? AND subject = ?")
    .run(pluginName, code, subject);
  return result.changes > 0;
}

/**
 * Drop every notice of a plugin — used on deactivate/uninstall, where the feature
 * that needed the binary is no longer loaded, so the notice would be noise.
 */
export function deletePluginNotices(pluginName: string): number {
  const db = getDbInstance();
  const result = db.prepare("DELETE FROM plugin_notices WHERE plugin_name = ?").run(pluginName);
  return result.changes;
}
