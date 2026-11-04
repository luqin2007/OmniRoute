/**
 * Plugin i18n overlays.
 *
 * A plugin may ship `<pluginDir>/i18n/<locale>.json` and declare
 * `contributes.i18n = { locales, allowNamespaces }`. Those strings are merged
 * OVER the host catalogue (plugin wins), which is what makes "translate the
 * dashboard" a plugin concern instead of a 60-file patch to src/i18n/messages.
 *
 * Guardrails:
 * - `allowNamespaces` limits a plugin to the namespaces it declared; without it a
 *   plugin could silently rewrite every label in the product.
 * - Reads are cached by (path, mtime) so the per-request cost is a stat call.
 * - Any failure yields no overlay: a broken translation file must never break
 *   rendering of the page it was trying to translate.
 *
 * @module plugins/i18n
 */

import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { logger } from "../../../open-sse/utils/logger.ts";
import { getPluginContributions, type ContributionBundle } from "./contributions";

const log = logger("PLUGIN_I18N");

/** Re-stat a translation file at most this often. */
const CACHE_TTL_MS = 5000;

/** Locale names are file names here — keep them boring. */
const LOCALE_PATTERN = /^[A-Za-z0-9_-]{2,20}$/;

interface CacheEntry {
  mtimeMs: number;
  checkedAt: number;
  messages: Record<string, unknown> | null;
}

const cache = new Map<string, CacheEntry>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep overlay where `source` (the plugin) wins over `target` (the host).
 *
 * Pure: only the branches the plugin actually touches are copied, so the shared
 * module-level message catalogues are never mutated between requests.
 * Prototype-polluting keys are skipped — plugin JSON is untrusted input.
 */
export function applyMessageOverlay(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, sourceValue] of Object.entries(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const targetValue = result[key];
    result[key] =
      isPlainObject(sourceValue) && isPlainObject(targetValue)
        ? applyMessageOverlay(targetValue, sourceValue)
        : sourceValue;
  }
  return result;
}

function restrictToNamespaces(
  messages: Record<string, unknown>,
  allowNamespaces: string[] | undefined
): Record<string, unknown> {
  if (!allowNamespaces || allowNamespaces.length === 0) return messages;
  const allowed = new Set(allowNamespaces);
  const restricted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(messages)) {
    if (allowed.has(key)) restricted[key] = value;
  }
  return restricted;
}

function resolveLocaleFile(pluginDir: string, locale: string): string | null {
  if (!LOCALE_PATTERN.test(locale)) return null;
  const base = resolve(pluginDir);
  const target = resolve(base, "i18n", `${locale}.json`);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

async function readLocaleFile(path: string): Promise<Record<string, unknown> | null> {
  const now = Date.now();
  const cached = cache.get(path);
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) return cached.messages;

  try {
    const info = await stat(path);
    if (cached && cached.mtimeMs === info.mtimeMs) {
      cache.set(path, { ...cached, checkedAt: now });
      return cached.messages;
    }

    const raw = await readFile(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const messages = isPlainObject(parsed) ? parsed : null;
    if (!messages) {
      log.warn("i18n.locale_not_object", { path });
    }
    cache.set(path, { mtimeMs: info.mtimeMs, checkedAt: now, messages });
    return messages;
  } catch (err: any) {
    // Missing file is the normal case for locales a plugin does not translate.
    if (err?.code !== "ENOENT") {
      log.warn("i18n.read_failed", { path, error: err?.message });
    }
    cache.set(path, { mtimeMs: -1, checkedAt: now, messages: null });
    return null;
  }
}

async function loadBundleMessages(
  bundle: ContributionBundle,
  locale: string
): Promise<Record<string, unknown> | null> {
  const i18n = bundle.contributes.i18n;
  if (!i18n) return null;

  const target = resolveLocaleFile(bundle.pluginDir, locale);
  if (!target) {
    log.warn("i18n.locale_rejected", { plugin: bundle.plugin, locale });
    return null;
  }

  const messages = await readLocaleFile(target);
  if (!messages) return null;
  return restrictToNamespaces(messages, i18n.allowNamespaces);
}

/**
 * All plugin overlays for one locale, already merged (later plugins win over
 * earlier ones, all of them win over the host catalogue).
 */
export async function loadPluginMessages(locale: string): Promise<Record<string, unknown>> {
  const bundles = await getPluginContributions();
  let overlay: Record<string, unknown> = {};

  for (const bundle of bundles) {
    try {
      const messages = await loadBundleMessages(bundle, locale);
      if (messages) overlay = applyMessageOverlay(overlay, messages);
    } catch (err: any) {
      log.warn("i18n.bundle_failed", { plugin: bundle.plugin, error: err?.message });
    }
  }

  return overlay;
}

/** One plugin's overlay for one locale (used by the debug/inspection endpoint). */
export async function getPluginMessages(
  plugin: string,
  locale: string
): Promise<Record<string, unknown> | null> {
  const bundles = await getPluginContributions();
  const bundle = bundles.find((entry) => entry.plugin === plugin);
  if (!bundle) return null;
  return loadBundleMessages(bundle, locale);
}
