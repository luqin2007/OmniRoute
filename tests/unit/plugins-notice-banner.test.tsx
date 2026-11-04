// @vitest-environment jsdom
//
// The notice banner is the only surface that tells an operator a plugin is missing a
// host binary. Two properties must hold: it shows the message verbatim, and it only
// disappears when someone clicks the close button — no timer, no auto-hide.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PluginNoticeBanner,
  type PluginNoticeView,
} from "@/shared/components/plugins/PluginNoticeBanner";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => (key === "dismissNotification" ? "Dismiss" : key),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTICE: PluginNoticeView = {
  id: "notice-1",
  pluginName: "needs-dsh",
  code: "missing_binary",
  subject: "dsh",
  message: 'Plugin "needs-dsh" needs the host command "dsh", which is not available.',
};

const cleanups: Array<() => void> = [];

function render(notices: PluginNoticeView[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PluginNoticeBanner notices={notices} />);
  });
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

beforeEach(() => {
  refresh.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  while (cleanups.length) cleanups.pop()!();
});

describe("PluginNoticeBanner", () => {
  it("renders nothing when there is no notice", () => {
    const container = render([]);
    expect(container.innerHTML).toBe("");
  });

  it("shows the plugin name and the full message", () => {
    const container = render([NOTICE]);
    expect(container.textContent).toContain("needs-dsh");
    expect(container.textContent).toContain('needs the host command "dsh"');
  });

  it("stays on screen when time passes", () => {
    const container = render([NOTICE]);
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(container.textContent).toContain("needs-dsh");
  });

  it("dismisses only after the operator clicks close", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const container = render([NOTICE]);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/plugins/notices/${NOTICE.id}`);
    expect(init.method).toBe("DELETE");
    expect(container.innerHTML).toBe("");
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the notice when the dismissal request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const container = render([NOTICE]);
    await act(async () => {
      container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("needs-dsh");
  });
});
