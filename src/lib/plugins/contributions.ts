/**
 * Plugin contributions — the read side of the declarative host-extension contract.
 *
 * A plugin's `plugin.json` declares what the HOST should materialise (provider
 * nodes, pages, nav entries, slots, endpoints, CSS hiding, i18n overlays). This
 * module collects those declarations for every ACTIVE plugin and caches the
 * result for a few seconds.
 *
 * Design notes:
 * - Declarations are read from DISK, not from the plugin child process: a plugin
 *   that crashes or times out must not take the dashboard down with it, and the
 *   manifest is the same stable fact the installer validated.
 * - The DB row is only a fallback (disk unreadable → keep serving the last
 *   install-time snapshot instead of dropping the plugin's UI).
 * - Any single plugin failing to parse is skipped, never fatal: contributions
 *   are a UI nicety, not a request-path dependency.
 *
 * @module plugins/contributions
 */

import { readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { listPlugins, type PluginRow } from "../db/plugins";
import {
  ProviderNodeContributionSchema,
  safeValidateManifest,
  type EndpointContribution,
  type PluginContributions,
  type ProviderNodeContribution,
} from "./manifest";
import { logger } from "../../../open-sse/utils/logger.ts";

const log = logger("PLUGIN_CONTRIBUTIONS");

/** How long a collected bundle is reused before the disk is read again. */
const CACHE_TTL_MS = 5000;

export interface ContributionBundle {
  plugin: string;
  pluginDir: string;
  contributes: PluginContributions;
}

interface CacheEntry {
  at: number;
  value: ContributionBundle[];
}

let cache: CacheEntry | null = null;
let inflight: Promise<ContributionBundle[]> | null = null;

/**
 * Drop the cache so the next read reflects an activate/deactivate/install.
 * Called by the manager on every lifecycle transition.
 */
export function invalidatePluginContributions(): void {
  cache = null;
  inflight = null;
}

function emptyContributions(): PluginContributions {
  return {};
}

/**
 * Resolve a manifest-relative file inside the plugin directory.
 * Returns null when the path escapes the plugin dir (a manifest must never
 * make the host read arbitrary files).
 */
function resolveInside(pluginDir: string, relativePath: string): string | null {
  const base = resolve(pluginDir);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

async function readContributesFromDisk(row: PluginRow): Promise<PluginContributions | null> {
  const manifestPath = join(row.pluginDir, "plugin.json");
  try {
    const raw = await readFile(manifestPath, "utf-8");
    const result = safeValidateManifest(JSON.parse(raw));
    // `in` rather than `!result.success`: the repo compiles with strict:false,
    // where a boolean literal discriminant does not narrow the union.
    if ("errors" in result) {
      log.warn("contributions.manifest_invalid", {
        plugin: row.name,
        errors: result.errors.slice(0, 3),
      });
      return null;
    }
    if (result.data.name !== row.name) return null;
    return result.data.contributes ?? emptyContributions();
  } catch (err: any) {
    log.debug("contributions.manifest_unreadable", { plugin: row.name, error: err?.message });
    return null;
  }
}

/**
 * Fallback: reuse the install-time snapshot stored in the DB.
 * The snapshot was validated by whatever schema version installed the plugin, so
 * it may lack `contributes` entirely — that is fine, the plugin simply has none.
 */
function readContributesFromSnapshot(row: PluginRow): PluginContributions {
  try {
    const parsed = JSON.parse(row.manifest) as { contributes?: unknown };
    if (!parsed?.contributes) return emptyContributions();
    const result = safeValidateManifest(parsed);
    if ("errors" in result) return emptyContributions();
    return result.data.contributes ?? emptyContributions();
  } catch {
    return emptyContributions();
  }
}

async function collect(): Promise<ContributionBundle[]> {
  const rows = listPlugins("active");
  if (rows.length === 0) return [];

  const bundles: ContributionBundle[] = [];
  for (const row of rows) {
    const fromDisk = await readContributesFromDisk(row);
    const contributes = fromDisk ?? readContributesFromSnapshot(row);
    if (!contributes || Object.keys(contributes).length === 0) continue;
    bundles.push({ plugin: row.name, pluginDir: row.pluginDir, contributes });
  }

  bundles.sort((a, b) => a.plugin.localeCompare(b.plugin));
  return bundles;
}

/**
 * All contributions from active plugins. Cached for {@link CACHE_TTL_MS} and
 * invalidated by the manager on lifecycle changes.
 */
export async function getPluginContributions(): Promise<ContributionBundle[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;

  inflight = collect()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .catch((err: any) => {
      log.warn("contributions.collect_failed", { error: err?.message });
      return cache?.value ?? [];
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/**
 * Expand a bundle's provider-node declaration list.
 *
 * `providerNodesFile` is read relative to the plugin directory and must stay
 * inside it. A malformed file yields no nodes plus a warning — it never blocks
 * the plugin's other contributions.
 */
export async function resolveProviderNodes(
  bundle: ContributionBundle
): Promise<ProviderNodeContribution[]> {
  const inline = bundle.contributes.providerNodes ?? [];
  const file = bundle.contributes.providerNodesFile;
  if (!file) return inline;

  const target = resolveInside(bundle.pluginDir, file);
  if (!target) {
    log.warn("contributions.provider_nodes_file_escapes", {
      plugin: bundle.plugin,
      file,
    });
    return inline;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) return inline;
    const raw = await readFile(target, "utf-8");
    const parsed = z.array(ProviderNodeContributionSchema).max(500).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      log.warn("contributions.provider_nodes_file_invalid", {
        plugin: bundle.plugin,
        file,
        errors: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return inline;
    }
    return inline.concat(parsed.data);
  } catch (err: any) {
    log.warn("contributions.provider_nodes_file_unreadable", {
      plugin: bundle.plugin,
      file,
      error: err?.message,
    });
    return inline;
  }
}

export interface ResolvedEndpoint {
  bundle: ContributionBundle;
  endpoint: EndpointContribution;
}

/**
 * Find the plugin endpoint matching a request path.
 *
 * The plugin child process is not consulted here — match is declarative, so an
 * inactive or crashed plugin can never answer a route.
 */
export async function findContributedEndpoint(
  method: string,
  pathname: string
): Promise<ResolvedEndpoint | null> {
  const bundles = await getPluginContributions();
  const normalizedMethod = method.toUpperCase();

  for (const bundle of bundles) {
    for (const endpoint of bundle.contributes.endpoints ?? []) {
      if (endpoint.method !== normalizedMethod) continue;
      if (endpoint.path === pathname) return { bundle, endpoint };
    }
  }
  return null;
}

/** Flat list of contributed nav entries, tagged with their owning plugin. */
export async function listNavContributions(): Promise<
  Array<{ plugin: string; nav: NonNullable<PluginContributions["nav"]>[number] }>
> {
  const bundles = await getPluginContributions();
  return bundles.flatMap((bundle) =>
    (bundle.contributes.nav ?? []).map((nav) => ({ plugin: bundle.plugin, nav }))
  );
}

/** Concatenate CSS hide rules from every active plugin. */
export async function getPluginCss(): Promise<string> {
  const bundles = await getPluginContributions();
  const selectors = bundles.flatMap((bundle) => bundle.contributes.css?.hiddenSelectors ?? []);
  const unique = Array.from(new Set(selectors.map((s) => s.trim()).filter(Boolean)));
  if (unique.length === 0) return "";
  return `${unique.join(",\n")}{display:none!important}`;
}

/** True when any active plugin opted into the password-reveal affordance. */
export async function isPasswordRevealEnabled(): Promise<boolean> {
  const bundles = await getPluginContributions();
  return bundles.some((bundle) => bundle.contributes.ui?.passwordReveal === true);
}
