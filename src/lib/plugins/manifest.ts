/**
 * Plugin manifest validator — Zod schema for plugin.json files.
 *
 * @module plugins/manifest
 */

import { z } from "zod";

// ── Permission enum ──

export const PermissionSchema = z.enum(["network", "file-read", "file-write", "env", "exec"]);
export type Permission = z.infer<typeof PermissionSchema>;

// ── Skill definition in manifest ──

export const ManifestSkillSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
});
export type ManifestSkill = z.infer<typeof ManifestSkillSchema>;

// ── Config schema field ──

export const ConfigFieldSchema = z.object({
  type: z.enum(["string", "number", "boolean", "select"]),
  default: z.unknown().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  enum: z.array(z.string()).optional(),
  description: z.string().optional(),
});
export type ConfigField = z.infer<typeof ConfigFieldSchema>;

// ── Hooks ──

export const HooksSchema = z.object({
  onRequest: z.boolean().optional(),
  onResponse: z.boolean().optional(),
  onError: z.boolean().optional(),
  onInstall: z.boolean().optional(),
  onActivate: z.boolean().optional(),
  onDeactivate: z.boolean().optional(),
  onUninstall: z.boolean().optional(),
  onStreamComplete: z.boolean().optional(),
});

// ── Requires ──

export const RequiresSchema = z.object({
  omniroute: z.string().optional(),
  permissions: z.array(PermissionSchema).optional(),
  /**
   * Host executables this plugin shells out to (`dsh`, `bun`, `uv`, …).
   *
   * A plugin that delegates work to a host binary cannot work without it. The host
   * resolves these on PATH when the plugin is activated and, for each one it cannot
   * find, raises a dismissible dashboard notice. A missing binary never fails the
   * activation itself — the plugin's declarative parts keep working.
   */
  binaries: z
    .array(
      z
        .string()
        .min(1)
        .max(64)
        // Binary names, not paths: a plugin must not be able to point the lookup at
        // an arbitrary file (which would turn this into a filesystem probe).
        .regex(/^[A-Za-z0-9._+-]+$/, "Binary name must be a plain command name (no slashes)")
    )
    .max(10)
    .optional(),
});

// ── Contributions ──
//
// A plugin declares what it wants the HOST to materialise. Declarations are read
// from disk by the server (never from the plugin child process), validated here,
// and rendered through host-owned components only — a plugin can never ship React,
// HTML or scripts into the dashboard.
//
// Every field is optional so manifests written before this contract existed keep
// validating unchanged.

/** Paths a plugin endpoint may claim: the two plugin-safe mounts only. */
const ENDPOINT_PATH = /^\/(?:v1|api\/v1)\/[a-z0-9\-/]*$/;

/** Host-rendered widget. Closed union: unknown `type` values fail validation. */
export const PluginWidgetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("providerNodeTable"),
    prefixRoot: z.string().min(1).max(60).optional(),
    emptyHint: z.string().max(300).optional(),
  }),
  z.object({
    type: z.literal("keyValue"),
    items: z.array(z.object({ label: z.string().max(80), value: z.string().max(500) })).max(50),
  }),
  z.object({
    type: z.literal("markdown"),
    text: z.string().max(20000),
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["info", "success", "warn", "error"]),
    title: z.string().max(120),
    text: z.string().max(2000),
  }),
  z.object({
    type: z.literal("actionButton"),
    label: z.string().min(1).max(60),
    action: z.enum(["refresh", "navigate", "syncProviderNodes"]),
    href: z.string().max(500).optional(),
    tone: z.enum(["primary", "neutral"]).optional(),
  }),
  z.object({
    type: z.literal("statusBadge"),
    label: z.string().min(1).max(60),
    tone: z.enum(["neutral", "success", "warn", "error"]),
  }),
  /**
   * Button that opens a host-owned modal, calls one plugin endpoint and renders
   * the reply as a whitelisted result block.
   *
   * This is how a plugin adds a per-row action (test this model, measure this
   * key, …) while the host keeps ownership of the modal, the request and the
   * rendering. The slot's context (providerId / modelId / fullModel) is merged
   * into the request body, so the button knows which row it belongs to without
   * the plugin ever touching the DOM.
   */
  z.object({
    type: z.literal("probeAction"),
    label: z.string().min(1).max(60),
    icon: z.string().max(40).optional(),
    /** Tooltip / dialog heading; defaults to `label`. */
    title: z.string().max(120).optional(),
    endpoint: z
      .string()
      .max(300)
      .regex(ENDPOINT_PATH, "Probe endpoint must live on /v1/ or /api/v1/"),
    /** GET skips the body; POST (default) sends `{...context, ...payload}`. */
    method: z.enum(["GET", "POST"]).optional(),
    /** Static fields merged into the request body. */
    payload: z.record(z.string(), z.unknown()).optional(),
    /** Render as an icon button (row actions) instead of a labelled button. */
    iconOnly: z.boolean().optional(),
    /** Emphasise the primary action in a group of probe buttons. */
    tone: z.enum(["primary", "neutral"]).optional(),
  }),
]);
export type PluginWidget = z.infer<typeof PluginWidgetSchema>;

/** A provider node the host mints while the plugin is active. */
export const ProviderNodeContributionSchema = z.object({
  name: z.string().min(1).max(120),
  prefix: z.string().min(1).max(80),
  type: z.enum(["openai-compatible", "anthropic-compatible"]).optional(),
  apiType: z
    .enum([
      "chat",
      "responses",
      "embeddings",
      "audio-transcriptions",
      "audio-speech",
      "images-generations",
    ])
    .optional(),
  baseUrl: z.string().min(1).max(500).optional(),
  notes: z.string().max(500).optional(),
});
export type ProviderNodeContribution = z.infer<typeof ProviderNodeContributionSchema>;

/** Extra providers-page section, keyed off a node prefix. */
export const ProviderGroupContributionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  prefixRoot: z.string().min(1).max(60),
  nodeType: z.enum(["openai-compatible", "anthropic-compatible"]).optional(),
  labelKey: z.string().max(120).optional(),
  labelFallback: z.string().min(1).max(120),
});
export type ProviderGroupContribution = z.infer<typeof ProviderGroupContributionSchema>;

/** Sidebar entry. `sectionId` is validated against the host's section list on merge. */
export const NavContributionSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80),
  href: z.string().startsWith("/").max(500),
  icon: z.string().max(60).optional(),
  i18nKey: z.string().max(120).optional(),
  labelFallback: z.string().min(1).max(120),
  subtitleKey: z.string().max(120).optional(),
  subtitleFallback: z.string().max(200).optional(),
  sectionId: z.string().max(40).optional(),
});
export type NavContribution = z.infer<typeof NavContributionSchema>;

/** Dashboard page served by the host renderer at /dashboard/plugin/<plugin>/<id>. */
export const PageContributionSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80),
  titleKey: z.string().max(120).optional(),
  titleFallback: z.string().min(1).max(120),
  descriptionFallback: z.string().max(400).optional(),
  widgets: z.array(PluginWidgetSchema).max(40),
});
export type PageContribution = z.infer<typeof PageContributionSchema>;

/**
 * Extra tab on a host screen that already ships a tab strip.
 *
 * `playground` is the only screen today; the field is an enum rather than a free
 * string so a manifest cannot claim a screen the host does not expose.
 */
export const TabContributionSchema = z.object({
  screen: z.enum(["playground"]),
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(60),
  labelFallback: z.string().min(1).max(60),
  icon: z.string().max(40).optional(),
  widgets: z.array(PluginWidgetSchema).max(40),
});
export type TabContribution = z.infer<typeof TabContributionSchema>;

/**
 * Injection point the host reserves inside an existing screen.
 *
 * Segments may be camelCase: host slot names predate this contract
 * (`provider.modelRow.trailing`, `apikey.row.actions`), so a kebab-only rule
 * would reject the very slots the dashboard already renders.
 */
export const SlotContributionSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/, "Slot names are dotted segments")
    .max(120),
  widgets: z.array(PluginWidgetSchema).max(20),
});
export type SlotContribution = z.infer<typeof SlotContributionSchema>;

/** API route served by the plugin child process through the /v1 catch-all. */
export const EndpointContributionSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().max(300).regex(ENDPOINT_PATH, "Endpoint path must start with /v1/ or /api/v1/"),
  handler: z
    .string()
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, "Handler must be an exported function name"),
  auth: z.enum(["none", "management"]).optional(),
  /**
   * Per-call timeout for this endpoint, capped at 5 minutes.
   *
   * Defaults to the IPC hook timeout (10s), which is far too short for handlers
   * that legitimately wait on an upstream model — probing a model takes as long
   * as the model takes to answer.
   */
  timeoutMs: z.number().int().min(1000).max(300_000).optional(),
});
export type EndpointContribution = z.infer<typeof EndpointContributionSchema>;

/** i18n overlay: plugin JSON files merged over the host catalogue (plugin wins). */
export const I18nContributionSchema = z.object({
  locales: z.array(z.string()).default(["en"]),
  allowNamespaces: z.array(z.string()).optional(),
});
export type I18nContribution = z.infer<typeof I18nContributionSchema>;

/** CSS-only hiding, for removing host chrome without shipping any script. */
export const CssContributionSchema = z.object({
  hiddenSelectors: z.array(z.string().min(1).max(300)).max(200).optional(),
});
export type CssContribution = z.infer<typeof CssContributionSchema>;

/** Host UI capabilities a plugin opts into. */
export const UiContributionSchema = z.object({
  passwordReveal: z.boolean().optional(),
});
export type UiContribution = z.infer<typeof UiContributionSchema>;

export const ContributesSchema = z.object({
  providerNodes: z.array(ProviderNodeContributionSchema).max(500).optional(),
  /** Relative path (inside the plugin dir) to a JSON array of provider nodes. */
  providerNodesFile: z.string().max(300).optional(),
  providerGroups: z.array(ProviderGroupContributionSchema).max(20).optional(),
  nav: z.array(NavContributionSchema).max(20).optional(),
  pages: z.array(PageContributionSchema).max(20).optional(),
  slots: z.array(SlotContributionSchema).max(40).optional(),
  tabs: z.array(TabContributionSchema).max(10).optional(),
  endpoints: z.array(EndpointContributionSchema).max(20).optional(),
  css: CssContributionSchema.optional(),
  i18n: I18nContributionSchema.optional(),
  ui: UiContributionSchema.optional(),
});
export type PluginContributions = z.infer<typeof ContributesSchema>;

// ── Full manifest ──

export const PluginManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Name must be kebab-case (lowercase, hyphens only)"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver (e.g. 1.0.0)"),
  description: z.string().max(500).optional(),
  author: z.string().max(200).optional(),
  license: z.string().optional(),
  main: z.string().optional(),
  source: z.enum(["local", "marketplace"]).optional(),
  tags: z.array(z.string()).optional(),
  requires: RequiresSchema.optional(),
  hooks: HooksSchema.optional(),
  skills: z.array(ManifestSkillSchema).optional(),
  enabledByDefault: z.boolean().optional(),
  configSchema: z.record(z.string(), ConfigFieldSchema).optional(),
  /**
   * Declarative host extensions (provider nodes, pages, nav, slots, endpoints, …).
   * Optional and additive: old manifests keep validating, and a manifest without
   * `contributes` behaves exactly as before.
   */
  contributes: ContributesSchema.optional(),
  /**
   * OPT-IN tamper-detection: `sha256-<base64>` of the plugin's entry file.
   *
   * NOT a security boundary — loopback-only routing and exec opt-in are the real
   * boundaries. Local-operator plugins without `integrity` are fully allowed (trust
   * is implicit for locally installed code). When this field IS present, the loader
   * verifies the entry file hash at load time and refuses to activate on mismatch.
   *
   * Format: `sha256-<base64url>` (same as SRI / W3C Subresource Integrity).
   * Generate with: `node -e "const {createHash}=require('crypto'),{readFileSync}=require('fs');
   *   console.log('sha256-'+createHash('sha256').update(readFileSync('index.js')).digest('base64'))"`
   */
  integrity: z.string().optional(),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// ── Defaults applied after parsing ──

export interface PluginManifestWithDefaults extends PluginManifest {
  license: string;
  main: string;
  source: "local" | "marketplace";
  tags: string[];
  requires: { omniroute?: string; permissions: Permission[]; binaries: string[] };
  hooks: {
    onRequest: boolean;
    onResponse: boolean;
    onError: boolean;
    onInstall: boolean;
    onActivate: boolean;
    onDeactivate: boolean;
    onUninstall: boolean;
    onStreamComplete: boolean;
  };
  skills: ManifestSkill[];
  enabledByDefault: boolean;
  configSchema: Record<string, ConfigField>;
  contributes: PluginContributions;
}

export function applyDefaults(manifest: PluginManifest): PluginManifestWithDefaults {
  return {
    ...manifest,
    license: manifest.license ?? "MIT",
    main: manifest.main ?? "index.js",
    source: manifest.source ?? "local",
    tags: manifest.tags ?? [],
    requires: {
      omniroute: manifest.requires?.omniroute,
      permissions: manifest.requires?.permissions ?? [],
      binaries: manifest.requires?.binaries ?? [],
    },
    hooks: {
      onRequest: manifest.hooks?.onRequest ?? false,
      onResponse: manifest.hooks?.onResponse ?? false,
      onError: manifest.hooks?.onError ?? false,
      onInstall: manifest.hooks?.onInstall ?? false,
      onActivate: manifest.hooks?.onActivate ?? false,
      onDeactivate: manifest.hooks?.onDeactivate ?? false,
      onUninstall: manifest.hooks?.onUninstall ?? false,
      onStreamComplete: manifest.hooks?.onStreamComplete ?? false,
    },
    skills: manifest.skills ?? [],
    enabledByDefault: manifest.enabledByDefault ?? false,
    configSchema: manifest.configSchema ?? {},
    contributes: manifest.contributes ?? {},
  };
}

// ── Validation ──

export function validateManifest(raw: unknown): PluginManifestWithDefaults {
  const parsed = PluginManifestSchema.parse(raw);
  return applyDefaults(parsed);
}

export function safeValidateManifest(
  raw: unknown
): { success: true; data: PluginManifestWithDefaults } | { success: false; errors: string[] } {
  const result = PluginManifestSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: applyDefaults(result.data) };
  }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

// ── Config validation ──

export type ValidatePluginConfigResult = { valid: true } | { valid: false; errors: string[] };

/**
 * Validate a config object against a ConfigField schema map.
 * Only provided keys are validated — missing keys are fine (use defaults).
 */
export function validatePluginConfig(
  config: Record<string, unknown>,
  schema: Record<string, ConfigField>
): ValidatePluginConfigResult {
  const errors: string[] = [];

  // If schema is empty, allow anything
  const hasSchema = Object.keys(schema).length > 0;
  if (!hasSchema) return { valid: true };

  for (const [key, value] of Object.entries(config)) {
    const field = schema[key];
    if (!field) {
      errors.push(`Unknown config key: ${key}`);
      continue;
    }

    switch (field.type) {
      case "string":
        if (typeof value !== "string") errors.push(`${key} must be a string`);
        break;
      case "number":
        if (typeof value !== "number") {
          errors.push(`${key} must be a number`);
        } else {
          if (field.min !== undefined && value < field.min)
            errors.push(`${key} must be >= ${field.min}`);
          if (field.max !== undefined && value > field.max)
            errors.push(`${key} must be <= ${field.max}`);
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") errors.push(`${key} must be a boolean`);
        break;
      case "select":
        if (!field.enum || !field.enum.includes(value as string))
          errors.push(`${key} must be one of: ${(field.enum ?? []).join(", ")}`);
        break;
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true };
}
