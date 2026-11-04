/**
 * `scan()` must refresh manifest-derived metadata for plugins that are already
 * registered — not just insert unknown ones.
 *
 * Regression: editing `plugin.json` (description, version, tags, contributions)
 * and pressing "scan" left the dashboard showing the copy captured at install
 * time, because the scan loop skipped every name that already had a row. The
 * refresh is metadata-only: `status`, `enabled` and `config` are runtime state
 * and must survive untouched, otherwise a rescan would silently re-activate or
 * disable a plugin.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PLUGIN_DIR = mkdtempSync(join(tmpdir(), "omr-plugin-scan-metadata-"));
process.env.OMNIROUTE_PLUGINS_DIR = PLUGIN_DIR;

const db = await import("../../src/lib/db/plugins.ts");
const { resetDbInstance } = await import("../../src/lib/db/core.ts");
const { pluginManager } = await import("../../src/lib/plugins/manager.ts");

const NAME = "demo-plugin";

test.after(() => {
  resetDbInstance();
  rmSync(PLUGIN_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function writePlugin(manifest: Record<string, unknown>): void {
  const dir = join(PLUGIN_DIR, NAME);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, "index.mjs"), "export default {};\n");
}

test("scan registers a new plugin from its manifest", async () => {
  writePlugin({
    name: NAME,
    version: "1.0.0",
    description: "English blurb",
    main: "index.mjs",
    tags: ["a"],
  });

  const result = await pluginManager.scan();
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));

  const row = db.getPluginByName(NAME);
  assert.ok(row, "plugin row should be inserted");
  assert.equal(row.description, "English blurb");
  assert.equal(row.version, "1.0.0");
  assert.equal(row.status, "installed");
  assert.equal(row.enabled, 0);
});

test("scan refreshes description/version/tags without touching runtime state", async () => {
  // Operator state that must survive the rescan.
  db.updatePluginStatus(NAME, "active");

  writePlugin({
    name: NAME,
    version: "1.0.1",
    description: "中文简介：示例插件",
    main: "index.mjs",
    tags: ["a", "b"],
    author: "tester",
  });

  const result = await pluginManager.scan();
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));

  const row = db.getPluginByName(NAME);
  assert.ok(row);
  assert.equal(row.description, "中文简介：示例插件");
  assert.equal(row.version, "1.0.1");
  assert.equal(row.author, "tester");
  assert.deepEqual(JSON.parse(row.tags), ["a", "b"]);
  // Runtime state is untouched by a metadata refresh.
  assert.equal(row.status, "active");
  assert.equal(row.enabled, 1);
});

test("scan leaves an unchanged plugin alone (no updated_at churn)", async () => {
  const before = db.getPluginByName(NAME);
  assert.ok(before);

  await new Promise((r) => setTimeout(r, 5));
  const result = await pluginManager.scan();
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));

  const after = db.getPluginByName(NAME);
  assert.ok(after);
  assert.equal(after.updatedAt, before.updatedAt, "unchanged manifest must not rewrite the row");
});
