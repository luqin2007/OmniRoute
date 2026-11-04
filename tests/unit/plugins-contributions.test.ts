import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { safeValidateManifest } = await import("../../src/lib/plugins/manifest.ts");
const { resolveProviderNodes } = await import("../../src/lib/plugins/contributions.ts");
const { buildPluginCss } = await import("../../src/lib/plugins/dashboard.ts");

const baseManifest = { name: "demo-plugin", version: "1.0.0" };

describe("contributes schema", () => {
  it("accepts a manifest without contributes and defaults it to an empty object", () => {
    const result = safeValidateManifest(baseManifest);
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.deepEqual(result.data.contributes, {});
  });

  it("accepts a fully declarative manifest", () => {
    const result = safeValidateManifest({
      ...baseManifest,
      contributes: {
        providerNodesFile: "catalog/providers.json",
        providerGroups: [{ id: "free", prefixRoot: "ofm-", labelFallback: "Free" }],
        nav: [{ id: "free-page", href: "/dashboard/plugin/demo/free", labelFallback: "Free" }],
        pages: [
          {
            id: "free",
            titleFallback: "Free",
            widgets: [{ type: "markdown", text: "hello" }],
          },
        ],
        slots: [
          {
            name: "provider.models.header",
            widgets: [{ type: "statusBadge", label: "ok", tone: "success" }],
          },
        ],
        endpoints: [{ method: "GET", path: "/v1/demo", handler: "handle" }],
        css: { hiddenSelectors: ['[data-omni-hide="sponsor"]'] },
        i18n: { locales: ["zh-CN"], allowNamespaces: ["sidebar"] },
        ui: { passwordReveal: true },
      },
    });

    assert.equal(result.success, true);
  });

  it("rejects an unknown widget type rather than rendering it", () => {
    const result = safeValidateManifest({
      ...baseManifest,
      contributes: {
        pages: [{ id: "x", titleFallback: "X", widgets: [{ type: "rawHtml", html: "<b>x</b>" }] }],
      },
    });

    assert.equal(result.success, false);
  });

  it("rejects endpoint paths outside /v1", () => {
    const result = safeValidateManifest({
      ...baseManifest,
      contributes: {
        endpoints: [{ method: "POST", path: "/api/settings", handler: "handle" }],
      },
    });

    assert.equal(result.success, false);
  });

  it("rejects a handler name that is not an identifier", () => {
    const result = safeValidateManifest({
      ...baseManifest,
      contributes: {
        endpoints: [{ method: "GET", path: "/v1/demo", handler: "../../evil" }],
      },
    });

    assert.equal(result.success, false);
  });

  it("accepts the camelCase slot names the dashboard already reserves", () => {
    const result = safeValidateManifest({
      ...baseManifest,
      contributes: {
        slots: [
          {
            name: "provider.modelRow.trailing",
            widgets: [{ type: "statusBadge", label: "ok", tone: "success" }],
          },
        ],
      },
    });

    assert.equal(result.success, true);
  });

  it("accepts a playground tab contribution", () => {
    const result = safeValidateManifest({
      ...baseManifest,
      contributes: {
        tabs: [
          {
            screen: "playground",
            id: "fingerprint",
            labelFallback: "指纹识别",
            icon: "fingerprint",
            widgets: [{ type: "markdown", text: "hello" }],
          },
        ],
      },
    });

    assert.equal(result.success, true);
  });

  it("rejects a tab for a screen the host does not expose", () => {
    const result = safeValidateManifest({
      ...baseManifest,
      contributes: {
        tabs: [{ screen: "settings", id: "x", labelFallback: "X", widgets: [] }],
      },
    });

    assert.equal(result.success, false);
  });

  it("accepts a probe widget only on plugin-safe mounts", () => {
    const probe = {
      type: "probeAction",
      label: "Fingerprint",
      endpoint: "/api/v1/fingerprint",
      method: "POST",
      iconOnly: true,
    };
    const allowed = safeValidateManifest({
      ...baseManifest,
      contributes: { slots: [{ name: "provider.modelRow.trailing", widgets: [probe] }] },
    });
    assert.equal(allowed.success, true);

    const blocked = safeValidateManifest({
      ...baseManifest,
      contributes: {
        slots: [
          {
            name: "provider.modelRow.trailing",
            widgets: [{ ...probe, endpoint: "/api/settings/x" }],
          },
        ],
      },
    });
    assert.equal(blocked.success, false);
  });

  it("caps endpoint timeouts at five minutes", () => {
    const result = safeValidateManifest({
      ...baseManifest,
      contributes: {
        endpoints: [{ method: "POST", path: "/v1/slow", handler: "slow", timeoutMs: 600_000 }],
      },
    });

    assert.equal(result.success, false);
  });
});

describe("buildPluginCss", () => {
  it("returns an empty string when no plugin hides anything", () => {
    assert.equal(buildPluginCss([]), "");
    assert.equal(buildPluginCss(["   ", ""]), "");
  });

  it("deduplicates selectors and emits one rule", () => {
    const css = buildPluginCss(['[data-omni-hide="sponsor"]', '[data-omni-hide="sponsor"]', ".x"]);
    assert.equal(css, '[data-omni-hide="sponsor"],\n.x{display:none!important}');
  });
});

describe("resolveProviderNodes", () => {
  const bundle = (pluginDir: string, contributes: Record<string, unknown>) => ({
    plugin: "demo-plugin",
    pluginDir,
    contributes: contributes as never,
  });

  it("returns inline nodes unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omni-plugin-nodes-"));
    try {
      const nodes = await resolveProviderNodes(
        bundle(dir, { providerNodes: [{ name: "A", prefix: "ofm-a" }] })
      );
      assert.deepEqual(nodes, [{ name: "A", prefix: "ofm-a" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads a catalogue file relative to the plugin directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omni-plugin-nodes-"));
    try {
      await mkdir(join(dir, "catalog"));
      await writeFile(
        join(dir, "catalog", "providers.json"),
        JSON.stringify([
          { name: "A", prefix: "ofm-a" },
          { name: "B", prefix: "ofm-b" },
        ])
      );

      const nodes = await resolveProviderNodes(
        bundle(dir, { providerNodesFile: "catalog/providers.json" })
      );
      assert.equal(nodes.length, 2);
      assert.deepEqual(
        nodes.map((node) => node.prefix),
        ["ofm-a", "ofm-b"]
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores a catalogue path that escapes the plugin directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omni-plugin-nodes-"));
    try {
      const nodes = await resolveProviderNodes(
        bundle(dir, { providerNodesFile: "../../etc/passwd" })
      );
      assert.deepEqual(nodes, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
