// Providers dashboard card ordering.
//
// Upstream pinned sponsor providers first (`sortProviderEntriesFeaturedFirst`,
// featuredProviders.ts) so the Kimi / Cheaper Inference cards led every
// category. This fork removed that pin entirely and renders each category in
// plain name order, exactly like any other provider — these tests keep the pin
// from coming back and keep the hidden-alias behavior intact.
import test from "node:test";
import assert from "node:assert/strict";

const providerPageUtils =
  await import("../../src/app/(dashboard)/dashboard/providers/providerPageUtils.ts");
const providers = await import("../../src/shared/constants/providers.ts");

const getProviderStats = () => ({ total: 0 });

test("the sponsor-pin API is gone from providerPageUtils", () => {
  assert.equal(
    (providerPageUtils as Record<string, unknown>).sortProviderEntriesFeaturedFirst,
    undefined,
    "the featured/sponsor pin must not be reintroduced"
  );
});

test("the featuredProviders module no longer exists", async () => {
  await assert.rejects(
    import("../../src/app/(dashboard)/dashboard/providers/featuredProviders.ts"),
    /Cannot find module|ERR_MODULE_NOT_FOUND/,
    "featuredProviders.ts (sponsor ranks, brand colors, partner ids) must stay deleted"
  );
});

test("filterConfiguredProviderEntries renders a category in plain name order", () => {
  const entry = (providerId: string, name: string) => ({
    providerId,
    provider: { id: providerId, name },
    stats: { total: 0 },
    displayAuthType: "apikey",
    toggleAuthType: "apikey",
  });

  const entries = [
    entry("zulu-provider", "Zulu Provider"),
    entry("moonshot", "Kimi"),
    entry("acme", "Acme"),
    entry("kimi-web", "Kimi Web"),
    entry("anthropic-clone", "Anthropic Clone"),
    entry("kimi-coding", "Kimi Code CLI"),
  ];

  const visible = providerPageUtils.filterConfiguredProviderEntries(entries, false);
  assert.deepEqual(
    visible.map((e) => e.providerId),
    ["acme", "anthropic-clone", "moonshot", "kimi-coding", "kimi-web", "zulu-provider"],
    "no provider is pinned ahead of the alphabetical order"
  );
});

test("real sections match the plain alphabetical sort (no sponsor pin anywhere)", () => {
  const oauthAll = providerPageUtils.buildStaticProviderEntries("oauth", getProviderStats);
  const oauth = providerPageUtils.filterConfiguredProviderEntries(oauthAll, false);
  assert.deepEqual(
    oauth.map((e) => e.providerId),
    providerPageUtils.sortProviderEntriesByName(oauthAll).map((e) => e.providerId)
  );

  const webCookieAll = providerPageUtils.buildStaticProviderEntries("web-cookie", getProviderStats);
  const webCookie = providerPageUtils.filterConfiguredProviderEntries(webCookieAll, false);
  assert.deepEqual(
    webCookie.map((e) => e.providerId),
    providerPageUtils.sortProviderEntriesByName(webCookieAll).map((e) => e.providerId)
  );

  const apiKeyAll = providerPageUtils.buildStaticProviderEntries("apikey", getProviderStats);
  const llmAll = apiKeyAll.filter(
    (entry) =>
      !providers.IMAGE_ONLY_PROVIDER_IDS.has(entry.providerId) &&
      !providers.AGGREGATOR_PROVIDER_IDS.has(entry.providerId) &&
      !providers.ENTERPRISE_CLOUD_PROVIDER_IDS.has(entry.providerId) &&
      !providers.VIDEO_PROVIDER_IDS.has(entry.providerId) &&
      !providers.EMBEDDING_RERANK_PROVIDER_IDS.has(entry.providerId)
  );
  const llm = providerPageUtils.filterConfiguredProviderEntries(llmAll, false);
  assert.deepEqual(
    llm.map((e) => e.providerId),
    providerPageUtils.sortProviderEntriesByName(llmAll).map((e) => e.providerId)
  );
});

test("kimi-coding-apikey and kimi never render as their own dashboard card in ANY section (hiddenFromDashboard)", () => {
  const categories = [
    "no-auth",
    "oauth",
    "web-cookie",
    "local",
    "search",
    "audio",
    "upstream-proxy",
    "apikey",
    "cloud-agent",
  ] as const;

  for (const category of categories) {
    const entries = providerPageUtils.buildStaticProviderEntries(category, getProviderStats);
    assert.equal(
      entries.some((e) => e.providerId === "kimi-coding-apikey"),
      false,
      `kimi-coding-apikey must not appear as its own card in the "${category}" category`
    );
    assert.equal(
      entries.some((e) => e.providerId === "kimi"),
      false,
      `kimi (legacy alias) must not appear as its own card in the "${category}" category`
    );
  }
});
