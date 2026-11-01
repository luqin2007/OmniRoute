/**
 * `src/lib/providers/modelHealthIndex.ts` — matching a dashboard model row to the health its
 * gateway reported.
 *
 * The interesting part is namespacing: the row id is `pomelo/openai/gpt-oss-120b`, the gateway
 * reports `openai/gpt-oss-120b`, and a suffix match must stop at a `/` boundary so `gpt-4o`
 * never inherits `gpt-4o-mini`'s numbers.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildModelHealthIndex,
  lookupModelHealth,
  normalizeModelKey,
} from "../../src/lib/providers/modelHealthIndex.ts";
import type { ModelHealthSource } from "../../src/lib/providers/perfMetrics.ts";

function source(origin: string, models: Array<Record<string, unknown>>): ModelHealthSource {
  return {
    origin,
    ok: true,
    error: null,
    report: {
      models: models as never,
      summary: null,
      windowStart: null,
      windowEnd: null,
    },
  };
}

const MODEL = (model: string, latencyMs: number, successRate = 100) => ({
  model,
  latencyMs,
  tps: 10,
  successRate,
  trend: [],
});

test("indexes every reported model, first origin wins", () => {
  const index = buildModelHealthIndex([
    source("https://a.example", [MODEL("openai/gpt-oss-120b", 441)]),
    source("https://b.example", [MODEL("openai/gpt-oss-120b", 999), MODEL("gpt-image-2", 20_100)]),
  ]);

  assert.equal(index.size, 2);
  assert.equal(index.get("openai/gpt-oss-120b")?.latencyMs, 441);
  assert.equal(index.get("openai/gpt-oss-120b")?.origin, "https://a.example");
  assert.equal(index.get("gpt-image-2")?.latencyMs, 20_100);
});

test("failed sources and empty payloads contribute nothing", () => {
  const index = buildModelHealthIndex([
    { origin: "https://down.example", ok: false, error: "HTTP 404", report: null },
    { origin: "https://empty.example", ok: true, error: null, report: null },
    null as unknown as ModelHealthSource,
  ]);
  assert.equal(index.size, 0);
  assert.equal(lookupModelHealth(index, "anything"), null);
});

test("lookup is exact first, then one / boundary either way", () => {
  const index = buildModelHealthIndex([
    source("https://a.example", [MODEL("openai/gpt-oss-120b", 441), MODEL("kimi-k3", 1900)]),
  ]);

  assert.equal(lookupModelHealth(index, "openai/gpt-oss-120b")?.latencyMs, 441);
  assert.equal(lookupModelHealth(index, "   "), null);
  assert.equal(lookupModelHealth(index, "OPENAI/GPT-OSS-120B")?.latencyMs, 441);
  assert.equal(lookupModelHealth(index, "models/openai/gpt-oss-120b")?.latencyMs, 441);
  // Row namespaced by the provider, gateway bare — suffix match.
  assert.equal(lookupModelHealth(index, "pomelo/kimi-k3")?.latencyMs, 1900);
  assert.equal(lookupModelHealth(index, "vendor/gpt-oss-120b"), null);
});

test("a substring never matches — gpt-4o must not inherit gpt-4o-mini", () => {
  const index = buildModelHealthIndex([
    source("https://a.example", [MODEL("gpt-4o-mini", 1), MODEL("vendor/x/gpt-4o", 2)]),
  ]);
  assert.equal(lookupModelHealth(index, "gpt-4o")?.latencyMs, 2);
  assert.equal(lookupModelHealth(index, "gpt-4o-mini")?.latencyMs, 1);
});

test("normalizeModelKey trims, lowercases and strips a models/ prefix", () => {
  assert.equal(normalizeModelKey("  OpenAI/GPT-4o  "), "openai/gpt-4o");
  assert.equal(normalizeModelKey("models/foo"), "foo");
  assert.equal(normalizeModelKey("models/"), "");
});

test("missing index is safe to query", () => {
  assert.equal(lookupModelHealth(null, "gpt-4o"), null);
  assert.equal(lookupModelHealth(undefined, "gpt-4o"), null);
  assert.equal(lookupModelHealth(new Map(), "gpt-4o"), null);
});
