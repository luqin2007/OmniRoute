/**
 * Host-requirement probing for plugins.
 *
 * A plugin may delegate work to a host executable (`requires.binaries`: `dsh`,
 * `bun`, …). The container ships none of those, and a plugin cannot be expected to
 * tell the operator why a feature silently does nothing — so activation probes
 * PATH and leaves a notice when something is missing.
 *
 * Two rules shape this module:
 *
 * 1. **Fail-open.** A missing binary never fails the activation. The plugin's
 *    declarative parts (nodes, pages, CSS, i18n) keep working, and the feature that
 *    shells out simply cannot be used yet.
 * 2. **No self-clearing notices.** A notice the operator closed stays closed even
 *    though the binary is still missing — re-probing on every restart or
 *    reactivation must not resurrect it. It is deleted only when the cause is gone
 *    (binary installed), so a later removal raises it again.
 *
 * @module plugins/requirements
 */

import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { clearPluginNotice, deletePluginNotices, upsertPluginNotice } from "../db/pluginNotices";
import { logger } from "../../../open-sse/utils/logger.ts";

const log = logger("PLUGIN_REQUIREMENTS");

export interface BinaryLookupOptions {
  /** Overrides `process.env.PATH` — tests and diagnostics pass their own. */
  pathEnv?: string;
  /** Overrides `process.platform` — tests pin the Windows branch. */
  platform?: NodeJS.Platform;
}

/** Executable names to try for one command on this platform. */
function candidateNames(binary: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [binary];
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);
  const lower = binary.toLowerCase();
  if (extensions.some((ext) => lower.endsWith(ext.toLowerCase()))) return [binary];
  return [binary, ...extensions.map((ext) => `${binary}${ext.toLowerCase()}`)];
}

/**
 * Absolute path of `binary` on PATH, or null when it is not installed.
 *
 * Rejects anything that is not a plain command name: a manifest must not be able
 * to turn this into a "does /etc/shadow exist" probe, and PATH lookup is the only
 * resolution rule that also holds inside a container.
 */
export function resolveHostBinary(
  binary: string,
  options: BinaryLookupOptions = {}
): string | null {
  if (!binary) return null;
  if (isAbsolute(binary) || binary.includes("/") || binary.includes("\\")) return null;

  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  const platform = options.platform ?? process.platform;
  if (!pathEnv) return null;

  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const name of candidateNames(binary, platform)) {
      const candidate = join(dir, name);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not in this directory — keep looking.
      }
    }
  }
  return null;
}

/** Subset of `binaries` that is not installed, in declaration order. */
export function findMissingHostBinaries(
  binaries: readonly string[],
  options: BinaryLookupOptions = {}
): string[] {
  return binaries.filter((binary) => resolveHostBinary(binary, options) === null);
}

/** Operator-facing text. Kept here so every surface shows the same wording. */
export function missingBinaryMessage(pluginName: string, binary: string): string {
  return (
    `Plugin "${pluginName}" needs the host command "${binary}", which is not available ` +
    `in this OmniRoute runtime. Install it on the host (or in the container image), then ` +
    `restart — or deactivate the plugin to stop the warning.`
  );
}

/**
 * Probe `binaries` and reconcile the notice table for this plugin.
 *
 * @returns the binaries that are still missing (also after a dismissed notice was
 *          preserved), so callers can log a single summary line.
 */
export function syncRequirementNotices(
  pluginName: string,
  binaries: readonly string[],
  options: BinaryLookupOptions = {}
): string[] {
  if (!Array.isArray(binaries) || binaries.length === 0) return [];

  const missing: string[] = [];
  for (const binary of binaries) {
    try {
      const resolved = resolveHostBinary(binary, options);
      if (resolved) {
        // Installed (maybe just now): forget the incident so a future removal warns again.
        clearPluginNotice(pluginName, "missing_binary", binary);
        continue;
      }
      missing.push(binary);
      upsertPluginNotice({
        pluginName,
        code: "missing_binary",
        subject: binary,
        message: missingBinaryMessage(pluginName, binary),
      });
    } catch (err: any) {
      // A notice is a courtesy: never let it break activation.
      log.warn("requirements.probe_failed", { plugin: pluginName, binary, error: err?.message });
    }
  }

  if (missing.length > 0) {
    log.warn("requirements.missing_binaries", { plugin: pluginName, missing });
  }
  return missing;
}

/** Drop this plugin's notices (deactivate/uninstall — the feature is gone). */
export function clearRequirementNotices(pluginName: string): number {
  try {
    return deletePluginNotices(pluginName);
  } catch (err: any) {
    log.warn("requirements.clear_failed", { plugin: pluginName, error: err?.message });
    return 0;
  }
}
