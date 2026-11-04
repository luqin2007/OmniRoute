/**
 * Plugin SDK — typed API for plugin developers.
 *
 * Provides `definePlugin()` factory and re-exports all types needed
 * to build OmniRoute plugins.
 *
 * @module plugins/sdk
 */

import type { Plugin, PluginContext, PluginResult, BlockingHookResult } from "./hooks.ts";

export type { Plugin, PluginContext, PluginResult, BlockingHookResult };

// ── Plugin Definition Helper ──

export interface PluginDefinition {
  /** Plugin name (kebab-case) */
  name: string;
  /** Priority (lower = runs first, default 100) */
  priority?: number;
  /** Start enabled? (default true) */
  enabled?: boolean;
  /** Hook: runs before chat handler. Can block or modify request. */
  onRequest?: (ctx: PluginContext) => Promise<PluginResult | void> | PluginResult | void;
  /** Hook: runs after chat handler. Can modify response. */
  onResponse?: (ctx: PluginContext, response: unknown) => Promise<unknown | void> | unknown | void;
  /** Hook: runs on handler error. Can recover or re-throw. */
  onError?: (ctx: PluginContext, error: Error) => Promise<unknown | void> | unknown | void;
}

/**
 * Define an OmniRoute plugin with type safety.
 *
 * @example
 * ```ts
 * import { definePlugin } from "omniroute/plugins/sdk";
 *
 * export default definePlugin({
 *   name: "my-plugin",
 *   priority: 50,
 *   onRequest: async (ctx) => {
 *     console.log(`Request ${ctx.requestId} for ${ctx.model}`);
 *   },
 *   onResponse: async (ctx, response) => {
 *     console.log(`Response for ${ctx.requestId}`);
 *     return response;
 *   },
 * });
 * ```
 */
export function definePlugin(def: PluginDefinition): Plugin {
  return {
    name: def.name,
    priority: def.priority ?? 100,
    enabled: def.enabled ?? true,
    onRequest: def.onRequest,
    onResponse: def.onResponse,
    onError: def.onError,
  };
}

// ── Utility Helpers ──

/**
 * Block a request with a 403 response.
 */
export function blockRequest(response?: unknown): PluginResult {
  return { blocked: true, response };
}

/**
 * Modify the request body.
 */
export function modifyBody(body: unknown): PluginResult {
  return { body };
}

/**
 * Add metadata to the request context.
 */
export function addMetadata(metadata: Record<string, unknown>): PluginResult {
  return { metadata };
}

/**
 * Read the operator-saved config for this plugin.
 *
 * The host serialises the `config` column (written by the dashboard config page)
 * into `OMNIROUTE_PLUGIN_CONFIG` before spawning the child process. Reading it is
 * intentionally tolerant: a malformed value yields `{}` rather than throwing, so
 * a bad config can never take down a plugin mid-request.
 */
export function getPluginConfig<T extends Record<string, unknown> = Record<string, unknown>>(): T {
  const raw = process.env.OMNIROUTE_PLUGIN_CONFIG;
  if (!raw) return {} as T;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
  } catch {
    // fall through to the empty object
  }
  return {} as T;
}

/**
 * Host gateway credentials for this plugin process.
 *
 * Injected only when the manifest declares the `network` permission. It lets a
 * plugin call the host's own `/v1` surface (`${origin}/v1/chat/completions`) with
 * `model: "<provider>/<model>"`, so the host resolves upstream credentials and
 * the plugin never handles the operator's provider keys.
 *
 * Returns `null` when the permission was not granted — callers must treat that
 * as "gateway unavailable", not as an empty credential.
 */
export function getPluginGateway(): { origin: string; apiKey: string } | null {
  const origin = process.env.OMNIROUTE_PLUGIN_GATEWAY_ORIGIN?.trim();
  const apiKey = process.env.OMNIROUTE_PLUGIN_GATEWAY_KEY?.trim();
  if (!origin || !apiKey) return null;
  return { origin, apiKey };
}
