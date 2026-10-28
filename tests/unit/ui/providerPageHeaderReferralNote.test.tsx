// @vitest-environment jsdom
/**
 * ProviderPageHeader — the discreet "Partner link" disclosure is driven ONLY by
 * the Radar referral path (`isReferralLink`), i.e. when `providerInfo.website`
 * was overridden with a monetized default link. Catalog provider websites are
 * plain navigation links in this fork: no affiliate/tracking tags (see
 * tests/unit/no-affiliate-tracking-tags.test.ts) and therefore no note.
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import ProviderPageHeader from "@/app/(dashboard)/dashboard/providers/[id]/components/ProviderPageHeader";

// No `.has` method — providerText() falls back to the hardcoded English default.
const t = (key: string) => key;

const PARTNER_NOTE = "Partner link — supports OmniRoute at no extra cost to you";

describe("ProviderPageHeader — partner-link disclosure", () => {
  let container: HTMLDivElement | null = null;
  const mounted: { root: Root; container: HTMLDivElement }[] = [];

  afterEach(async () => {
    for (const instance of mounted.splice(0)) {
      await act(async () => instance.root.unmount());
      instance.container.remove();
    }
    if (container) {
      container = null;
    }
  });

  function renderHeader(
    id: string,
    name: string,
    website: string,
    isReferralLink: boolean = false
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() => {
      root.render(
        <ProviderPageHeader
          providerId={id}
          providerInfo={{ id, name, website, color: "#1783FF" }}
          connectionsCount={0}
          isOpenAICompatible={false}
          isAnthropicProtocolCompatible={false}
          isReferralLink={isReferralLink}
          onOpenTutorial={() => {}}
          t={t}
        />
      );
    });
    return container;
  }

  it.each([
    ["moonshot", "Kimi", "https://platform.kimi.ai"],
    ["kimi-coding", "Kimi Code CLI", "https://www.kimi.ai/code"],
    ["kimi-web", "Kimi Web", "https://www.kimi.ai"],
    ["cheaperinference", "Cheaper Inference", "https://cheaperinference.com/"],
    ["openai", "OpenAI", "https://openai.com"],
  ])("does NOT flag the %s catalog website link as a partner link", (id, name, website) => {
    const el = renderHeader(id, name, website);
    // The component also renders a "Back to Providers" <Link> above the
    // website title link — target the website anchor specifically, not the
    // first <a> in the tree.
    const link = el.querySelector(`a[href="${website}"]`);
    expect(link).not.toBeNull();
    expect(link?.getAttribute("title")).toBeNull();
    expect(link?.getAttribute("aria-label")).toBeNull();
    expect(el.textContent).not.toContain("Partner link");
  });

  it("flags a Radar referral link as a partner link", () => {
    const website = "https://example-provider.test/?ref=radar";
    const el = renderHeader("example", "Example", website, true);
    const link = el.querySelector(`a[href="${website}"]`);
    expect(link).not.toBeNull();
    expect(link?.getAttribute("title")).toBe(PARTNER_NOTE);
    expect(link?.getAttribute("aria-label")).toBe(`Example — ${PARTNER_NOTE}`);
    expect(el.textContent).toContain(PARTNER_NOTE);
  });
});
