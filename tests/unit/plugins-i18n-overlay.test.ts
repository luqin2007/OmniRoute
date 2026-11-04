import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { applyMessageOverlay } = await import("../../src/lib/plugins/i18n.ts");

describe("plugin i18n overlay", () => {
  it("lets the plugin override an existing host string", () => {
    const host = { providers: { title: "Providers" } };
    const plugin = { providers: { title: "提供商" } };

    assert.deepEqual(applyMessageOverlay(host, plugin), {
      providers: { title: "提供商" },
    });
  });

  it("adds keys the host does not have", () => {
    const host = { sidebar: { home: "Home" } };
    const plugin = { sidebar: { pluginOurFreeModelTitle: "免费模型" } };

    assert.deepEqual(applyMessageOverlay(host, plugin), {
      sidebar: { home: "Home", pluginOurFreeModelTitle: "免费模型" },
    });
  });

  it("does not mutate the host catalogue between requests", () => {
    const host = { providers: { title: "Providers", desc: "Host" } };
    const snapshot = JSON.stringify(host);

    applyMessageOverlay(host, { providers: { title: "提供商" } });

    assert.equal(JSON.stringify(host), snapshot);
  });

  it("keeps sibling keys of nested objects", () => {
    const host = { common: { loading: "Loading...", refresh: "Refresh" } };
    const merged = applyMessageOverlay(host, { common: { loading: "加载中…" } });

    assert.deepEqual(merged, { common: { loading: "加载中…", refresh: "Refresh" } });
  });

  it("ignores prototype-polluting keys", () => {
    const host = { common: { loading: "Loading..." } };
    const merged = applyMessageOverlay(host, {
      __proto__: { polluted: true },
      constructor: { bad: true },
      common: { loading: "加载中…" },
    } as Record<string, unknown>);

    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.deepEqual(merged, { common: { loading: "加载中…" } });
  });
});
