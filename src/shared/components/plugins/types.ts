/**
 * Client-safe shapes for plugin contributions.
 *
 * Mirrors the Zod contract in `src/lib/plugins/manifest.ts`, but as plain
 * serialisable data: the server reads the manifests and hands the dashboard a
 * JSON payload, so nothing here imports server-only modules.
 */

/** Closed widget union — the host renders these and nothing else. */
export type PluginWidgetSpec =
  | { type: "providerNodeTable"; prefixRoot?: string; emptyHint?: string }
  | { type: "keyValue"; items: Array<{ label: string; value: string }> }
  | { type: "markdown"; text: string }
  | { type: "callout"; tone: "info" | "success" | "warn" | "error"; title: string; text: string }
  | {
      type: "actionButton";
      label: string;
      action: "refresh" | "navigate" | "syncProviderNodes";
      href?: string;
      tone?: "primary" | "neutral";
    }
  | { type: "statusBadge"; label: string; tone: "neutral" | "success" | "warn" | "error" }
  | {
      type: "probeAction";
      label: string;
      icon?: string;
      title?: string;
      endpoint: string;
      method?: "GET" | "POST";
      payload?: Record<string, unknown>;
      iconOnly?: boolean;
      tone?: "primary" | "neutral";
    };

/**
 * Context the host hands to a slot's widgets (provider id, model id, …).
 *
 * Values are plain strings so a widget can forward them to a plugin endpoint
 * without the plugin having to know how a screen is laid out.
 */
export type PluginWidgetContext = Record<string, string>;

/** Whitelisted result body a probe endpoint may return. */
export interface PluginProbeResult {
  title?: string;
  tone?: "neutral" | "info" | "success" | "warn" | "error";
  summary?: Array<{ label: string; value: string }>;
  table?: { columns: string[]; rows: string[][] };
  notes?: string[];
  error?: string;
}

export interface PluginNavContribution {
  id: string;
  plugin: string;
  href: string;
  icon?: string;
  i18nKey?: string;
  labelFallback: string;
  subtitleKey?: string;
  subtitleFallback?: string;
  sectionId?: string;
}

export interface PluginProviderGroup {
  id: string;
  plugin: string;
  prefixRoot: string;
  nodeType?: "openai-compatible" | "anthropic-compatible";
  labelKey?: string;
  labelFallback: string;
}

export interface PluginPageRef {
  id: string;
  plugin: string;
  path: string;
  titleKey?: string;
  titleFallback: string;
  descriptionFallback?: string;
}

export interface PluginSlotContribution {
  name: string;
  plugin: string;
  widgets: PluginWidgetSpec[];
}

export interface PluginTabContribution {
  screen: "playground";
  id: string;
  plugin: string;
  labelFallback: string;
  icon?: string;
  widgets: PluginWidgetSpec[];
}

export interface PluginContributionsPayload {
  nav: PluginNavContribution[];
  providerGroups: PluginProviderGroup[];
  pages: PluginPageRef[];
  slots: PluginSlotContribution[];
  tabs: PluginTabContribution[];
  /** CSS selectors the host hides wholesale (sponsor chrome, affiliate badges, …). */
  css: string[];
  ui: { passwordReveal: boolean };
  plugins: Array<{ name: string }>;
}

export const EMPTY_PLUGIN_CONTRIBUTIONS: PluginContributionsPayload = {
  nav: [],
  providerGroups: [],
  pages: [],
  slots: [],
  tabs: [],
  css: [],
  ui: { passwordReveal: false },
  plugins: [],
};
