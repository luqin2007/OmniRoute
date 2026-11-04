/**
 * Plugin/Middleware Architecture — L-8
 *
 * Pre/post hooks on the request pipeline. Plugins are registered
 * with a priority (lower = runs first) and can intercept requests
 * before they reach the chat handler or modify responses after.
 *
 * Lifecycle:
 *   onRequest  → runs BEFORE chat handler (can block/modify request)
 *   onResponse → runs AFTER  chat handler (can modify/log response)
 *   onError    → runs on handler errors (can recover or re-throw)
 *
 * @module lib/plugins
 *
 * @deprecated Import from "./hooks.ts" or "./sdk.ts" directly.
 * This module re-exports from hooks.ts for backward compatibility.
 */

// Re-export types from hooks.ts (canonical source)
export type {
  PluginContext,
  PluginResult,
  Plugin,
  BlockingHookResult,
  HookHandler,
  HookRegistration,
} from "./hooks.ts";

// Re-export execution functions from hooks.ts
export {
  runOnRequest,
  runOnResponse,
  runOnError,
  resetHooks as resetPlugins,
  registerHook as registerPlugin,
  unregisterHooks as unregisterPluginList,
  getHooks as listPlugins,
} from "./hooks.ts";

// Backward compat: old code may import unregisterPlugin (singular)
export { unregisterHooks as unregisterPlugin } from "./hooks.ts";

import { getActiveEvents, getHooks, unregisterHooks } from "./hooks.ts";

/**
 * Backward-compat shim for the legacy `setPluginEnabled(name, enabled)` export.
 *
 * The hook registry has no per-plugin "enabled" flag anymore — a plugin is
 * active iff its hooks are registered, and disabling one means unregistering
 * its hooks. This preserves the old export so external callers don't crash:
 *   - enabled=false → unregister the plugin's hooks (returns true if any existed)
 *   - enabled=true  → reports current registration state; it cannot re-register
 *     a handler without the definition. Use `pluginManager.activate(name)` for
 *     the DB-backed lifecycle re-activation instead.
 *
 * @deprecated Prefer `pluginManager.activate/deactivate` or `unregisterHooks`.
 */
export function setPluginEnabled(name: string, enabled: boolean): boolean {
  const hasHooks = (): boolean =>
    getActiveEvents().some((event) => getHooks(event).some((h) => h.pluginName === name));
  if (!enabled) {
    const existed = hasHooks();
    unregisterHooks(name);
    return existed;
  }
  return hasHooks();
}

// Re-export SDK utilities
export {
  definePlugin,
  blockRequest,
  modifyBody,
  addMetadata,
  getPluginConfig,
  getPluginGateway,
} from "./sdk.ts";

// Declarative host extensions (contributes) — types for plugin authors and the
// host-side readers used by the dashboard, the /v1 dispatcher and i18n.
export type {
  PluginContributions,
  PluginWidget,
  ProviderNodeContribution,
  ProviderGroupContribution,
  NavContribution,
  PageContribution,
  SlotContribution,
  EndpointContribution,
  I18nContribution,
  CssContribution,
  UiContribution,
} from "./manifest.ts";
export {
  getPluginContributions,
  invalidatePluginContributions,
  findContributedEndpoint,
  listNavContributions,
  getPluginCss,
  isPasswordRevealEnabled,
} from "./contributions.ts";
export { dispatchPluginEndpoint } from "./endpoints.ts";
