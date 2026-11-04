// @vitest-environment jsdom
//
// The probe widget is how a plugin adds a per-row action without shipping any
// browser code: the host owns the button, the dialog and the rendering, and the
// plugin only answers an endpoint. These tests pin that contract — including the
// fact that the slot's row context reaches the plugin request body.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginContributionsProvider } from "@/shared/components/plugins/PluginContributionsProvider";
import { PluginSlot } from "@/shared/components/plugins/PluginSlot";
import {
  EMPTY_PLUGIN_CONTRIBUTIONS,
  type PluginContributionsPayload,
  type PluginWidgetSpec,
} from "@/shared/components/plugins/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

// React 19 only emits act() bookkeeping when this flag is set in a test runtime.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROBE: PluginWidgetSpec = {
  type: "probeAction",
  label: "指纹识别",
  title: "模型指纹识别",
  icon: "fingerprint",
  endpoint: "/api/v1/fingerprint",
  method: "POST",
  payload: { rounds: 1 },
  iconOnly: true,
};

function payloadWith(widgets: PluginWidgetSpec[]): PluginContributionsPayload {
  return {
    ...EMPTY_PLUGIN_CONTRIBUTIONS,
    slots: [{ name: "provider.modelRow.trailing", plugin: "fingerprint", widgets }],
  };
}

const cleanups: Array<() => void> = [];

function renderSlot(payload: PluginContributionsPayload, context?: Record<string, string>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PluginContributionsProvider value={payload}>
        <PluginSlot name="provider.modelRow.trailing" variant="inline" context={context} />
      </PluginContributionsProvider>
    );
  });
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("plugin probe widget", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders nothing when no plugin contributes to the slot", () => {
    renderSlot(EMPTY_PLUGIN_CONTRIBUTIONS);
    expect(document.querySelector("button")).toBeNull();
  });

  it("posts the slot context plus the declared payload to the plugin endpoint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ title: "最接近：gpt-5", notes: ["参考库内排序"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderSlot(payloadWith([PROBE]), {
      providerId: "openai",
      modelId: "gpt-4o",
      fullModel: "openai/gpt-4o",
    });

    const button = document.querySelector<HTMLButtonElement>('button[aria-label="指纹识别"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/fingerprint");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      providerId: "openai",
      modelId: "gpt-4o",
      fullModel: "openai/gpt-4o",
      rounds: 1,
    });

    expect(document.body.textContent).toContain("最接近：gpt-5");
    expect(document.body.textContent).toContain("参考库内排序");
  });

  it("surfaces the plugin error message instead of a stack trace", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "Please select a model first." } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
    ) as unknown as typeof fetch;

    renderSlot(payloadWith([PROBE]), { fullModel: "" });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="指纹识别"]')?.click();
    });
    await flush();

    // Without a NextIntlClientProvider the probe dialog falls back to English.
    expect(document.body.textContent).toContain("Cannot run probe");
    expect(document.body.textContent).toContain("Please select a model first.");
  });

  it("ignores unrecognised fields in the plugin reply", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            title: "ok",
            rawHtml: "<img src=x onerror=alert(1)>",
            summary: [{ label: "判定", value: "scored" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    ) as unknown as typeof fetch;

    renderSlot(payloadWith([PROBE]), { fullModel: "openai/gpt-4o" });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="指纹识别"]')?.click();
    });
    await flush();

    expect(document.body.textContent).toContain("scored");
    expect(document.body.innerHTML).not.toContain("onerror");
    expect(document.querySelector("img")).toBeNull();
  });
});
