// Fork guard: provider catalog `website` fields are plain navigation links.
//
// The upstream project wires affiliate/referral tracking tags into some of
// them (Kimi's `?aff=omniroute`, Cheaper Inference's `?utm_source=omniroute`).
// This fork strips those tags and removes every sponsor surface that displayed
// them (banners, provider-card badges); this test keeps them from creeping
// back in, and keeps the providers themselves working as ordinary providers
// (display-name/URL changes must never touch ids, aliases or runtime config).
import test from "node:test";
import assert from "node:assert/strict";

const providers = await import("../../src/shared/constants/providers.ts");

// Query parameters that attribute a visit to a referral/affiliate program.
const TRACKING_PARAM =
  /[?&](aff|affiliate|aff_id|ref|referral|track_id|invite|invite_code|utm_source|utm_medium|utm_campaign)=/i;

const KIMI_PROVIDER_IDS = [
  "kimi",
  "kimi-coding",
  "kimi-coding-apikey",
  "kimi-web",
  "moonshot",
] as const;

function allProviders(): Array<{ id: string; name?: string; website?: string }> {
  return [
    ...Object.values(providers.APIKEY_PROVIDERS),
    ...Object.values(providers.OAUTH_PROVIDERS),
    ...Object.values(providers.WEB_COOKIE_PROVIDERS),
  ] as Array<{ id: string; name?: string; website?: string }>;
}

test("no provider website carries an affiliate/referral tracking tag", () => {
  for (const provider of allProviders()) {
    if (!provider.website) continue;
    assert.doesNotMatch(
      provider.website,
      TRACKING_PARAM,
      `${provider.id}.website must be a plain link, got ${provider.website}`
    );
  }
});

test("the known upstream tracking tags are gone", () => {
  assert.equal(providers.APIKEY_PROVIDERS.moonshot.website, "https://platform.kimi.ai");
  assert.equal(
    providers.APIKEY_PROVIDERS["kimi-coding-apikey"].website,
    "https://www.kimi.ai/code"
  );
  assert.equal(providers.APIKEY_PROVIDERS.kimi.website, "https://platform.kimi.ai");
  assert.equal(providers.OAUTH_PROVIDERS["kimi-coding"].website, "https://www.kimi.ai/code");
  assert.equal(
    providers.APIKEY_PROVIDERS.cheaperinference.website,
    "https://cheaperinference.com/"
  );
});

test("moonshot: id/alias/routing untouched, display name stays 'Kimi'", () => {
  const moonshot = providers.APIKEY_PROVIDERS.moonshot;
  assert.ok(moonshot, "moonshot must still exist in the apikey catalog");
  assert.equal(moonshot.id, "moonshot", "id must never change — DB/routes/combos address it by id");
  assert.equal(moonshot.alias, "moonshot", "alias must never change");
  assert.equal(moonshot.name, "Kimi", "display name");
});

test("the Kimi-family providers still exist and are addressable by their ids", () => {
  assert.equal(providers.OAUTH_PROVIDERS["kimi-coding"].name, "Kimi Code CLI");
  assert.equal(providers.WEB_COOKIE_PROVIDERS["kimi-web"].name, "Kimi Web");
  assert.equal(providers.WEB_COOKIE_PROVIDERS["kimi-web"].website, "https://www.kimi.ai");
  for (const id of KIMI_PROVIDER_IDS) {
    const found = allProviders().some((provider) => provider.id === id);
    assert.ok(found, `${id} must remain in the catalog`);
  }
});

test("no Kimi provider website points at the unattributed legacy platform.moonshot.ai domain", () => {
  for (const provider of allProviders()) {
    if (!KIMI_PROVIDER_IDS.includes(provider.id as (typeof KIMI_PROVIDER_IDS)[number])) continue;
    if (!provider.website) continue;
    assert.doesNotMatch(
      provider.website,
      /^https:\/\/platform\.moonshot\.ai\/?$/,
      `${provider.id}.website must not be the unattributed legacy domain`
    );
  }
});

test("runtime endpoints are untouched (moonshot API base URL still api.moonshot.ai)", async () => {
  // Guard against a display-layer change ever leaking into runtime config —
  // `website` is a UI navigation field only, never a fetch target.
  const registry = await import("../../open-sse/config/providers/registry/moonshot/index.ts");
  assert.equal(registry.moonshotProvider.baseUrl, "https://api.moonshot.ai/v1/chat/completions");
});
