/**
 * Provider self-reported model health (`src/lib/providers/perfMetrics.ts`).
 *
 * The two payloads used below are copied verbatim (trimmed) from the live gateways that ship
 * the `/api/perf-metrics/summary` endpoint, one per shape:
 *
 *  - `NEWER_GATEWAY` (api.67.si) — `data.summary`, `data.window_*`, `recent_success_series`
 *  - `OLDER_GATEWAY` (api.2020111.xyz) — no summary/window, positional `recent_success_rates`
 *
 * Pure parsing only: no fetch, no SQLite.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  PERF_METRICS_DEFAULT_HOURS,
  PERF_METRICS_MAX_HOURS,
  PERF_METRICS_TREND_BUCKETS,
  buildPerfMetricsUrl,
  clampPerfMetricsHours,
  normalizePerfMetricsPayload,
  perfMetricsOrigin,
  successRateTone,
} from "../../src/lib/providers/perfMetrics.ts";

const NEWER_GATEWAY = {
  data: {
    summary: { avg_latency_ms: 8333, success_rate: 72.8, avg_tps: 174.85 },
    window_start: 1793430000,
    window_end: 1793513841,
    models: [
      {
        model_name: "openai/gpt-oss-120b",
        avg_latency_ms: 441,
        success_rate: 100,
        avg_tps: 196.43,
        recent_success_series: [
          { ts: 1793498400, success_rate: 100 },
          { ts: 1793502000, success_rate: 100 },
          { ts: 1793505600, success_rate: 40 },
        ],
      },
    ],
  },
};

const OLDER_GATEWAY = {
  data: {
    models: [
      {
        model_name: "翻译",
        avg_latency_ms: 2742,
        success_rate: 99.92,
        avg_tps: 57.32,
        recent_success_rates: [100, 99.49, 100],
      },
      {
        model_name: "kimi-k3",
        avg_latency_ms: 1900,
        success_rate: 0,
        avg_tps: 0,
        recent_success_rates: [0, 0, 0],
      },
    ],
  },
  success: true,
};

test("normalizes the newer gateway shape, keeping the gateway's own summary", () => {
  const report = normalizePerfMetricsPayload(NEWER_GATEWAY);
  assert.ok(report);
  assert.equal(report.models.length, 1);

  const [model] = report.models;
  assert.equal(model.model, "openai/gpt-oss-120b");
  assert.equal(model.latencyMs, 441);
  assert.equal(model.tps, 196.43);
  assert.equal(model.successRate, 100);
  assert.deepEqual(
    model.trend.map((bucket) => bucket.successRate),
    [100, 100, 40]
  );
  assert.deepEqual(
    model.trend.map((bucket) => bucket.ts),
    [1793498400, 1793502000, 1793505600]
  );

  assert.deepEqual(report.summary, {
    latencyMs: 8333,
    successRate: 72.8,
    tps: 174.85,
    derived: false,
  });
  assert.equal(report.windowStart, 1793430000);
  assert.equal(report.windowEnd, 1793513841);
});

test("normalizes the older gateway shape and derives a summary from the model rows", () => {
  const report = normalizePerfMetricsPayload(OLDER_GATEWAY);
  assert.ok(report);
  assert.equal(report.models.length, 2);
  assert.equal(report.windowStart, null);
  assert.equal(report.windowEnd, null);

  // No timestamps in this shape, so the bars are positional.
  assert.deepEqual(
    report.models[0].trend.map((bucket) => bucket.ts),
    [null, null, null]
  );
  assert.deepEqual(
    report.models[0].trend.map((bucket) => bucket.successRate),
    [100, 99.49, 100]
  );

  assert.ok(report.summary);
  assert.equal(report.summary.derived, true);
  assert.equal(report.summary.latencyMs, (2742 + 1900) / 2);
  assert.equal(report.summary.successRate, (99.92 + 0) / 2);
});

test("keeps only the last 8 hourly buckets, oldest first", () => {
  const series = Array.from({ length: 24 }, (_, hour) => ({
    ts: 1793430000 + hour * 3600,
    success_rate: hour,
  }));
  const report = normalizePerfMetricsPayload({
    data: { models: [{ model_name: "m", recent_success_series: series }] },
  });

  assert.ok(report);
  const { trend } = report.models[0];
  assert.equal(PERF_METRICS_TREND_BUCKETS, 8);
  assert.equal(trend.length, 8);
  assert.equal(trend[0].successRate, 16);
  assert.equal(trend[7].successRate, 23);
});

test("returns null instead of a fake empty table", () => {
  assert.equal(normalizePerfMetricsPayload(null), null);
  assert.equal(normalizePerfMetricsPayload("nope"), null);
  assert.equal(normalizePerfMetricsPayload({ data: { models: [] } }), null);
  // Explicit failure envelope from the gateway.
  assert.equal(
    normalizePerfMetricsPayload({ success: false, data: { models: [{ model_name: "m" }] } }),
    null
  );
  // Rows without a usable model name are dropped, and an all-dropped list is "no data".
  assert.equal(normalizePerfMetricsPayload({ data: { models: [{ success_rate: 100 }] } }), null);
});

test("dedupes repeated model rows and drops malformed buckets", () => {
  const report = normalizePerfMetricsPayload({
    data: {
      models: [
        { model_name: "dup", avg_latency_ms: 10, recent_success_series: [{ ts: 1 }] },
        { model_name: "dup", avg_latency_ms: 999 },
        { model_name: "ok", recent_success_rates: [100, "oops", null, 50] },
      ],
    },
  });

  assert.ok(report);
  assert.deepEqual(
    report.models.map((model) => model.model),
    ["dup", "ok"]
  );
  // A bucket without a rate is skipped, not coerced to zero.
  assert.deepEqual(report.models[0].trend, []);
  assert.deepEqual(
    report.models[1].trend.map((bucket) => bucket.successRate),
    [100, 50]
  );
});

test("clamps percentages into 0..100 and rejects negative latency", () => {
  const report = normalizePerfMetricsPayload({
    data: {
      models: [
        {
          model_name: "clamp",
          avg_latency_ms: -5,
          avg_tps: -1,
          success_rate: 140,
          recent_success_rates: [-20],
        },
      ],
    },
  });

  assert.ok(report);
  const [model] = report.models;
  assert.equal(model.latencyMs, null);
  assert.equal(model.tps, null);
  assert.equal(model.successRate, 100);
  assert.deepEqual(
    model.trend.map((bucket) => bucket.successRate),
    [0]
  );
});

test("extracts the gateway origin from a /v1 base URL", () => {
  assert.equal(perfMetricsOrigin("https://api.67.si/v1"), "https://api.67.si");
  assert.equal(perfMetricsOrigin("https://api.67.si/v1/"), "https://api.67.si");
  assert.equal(perfMetricsOrigin("https://api.2020111.xyz"), "https://api.2020111.xyz");
  assert.equal(perfMetricsOrigin("http://127.0.0.1:3000/v1"), "http://127.0.0.1:3000");
  assert.equal(perfMetricsOrigin("ftp://api.67.si"), null);
  assert.equal(perfMetricsOrigin("not a url"), null);
  assert.equal(perfMetricsOrigin(null), null);
  assert.equal(perfMetricsOrigin("   "), null);
});

test("builds the summary URL and clamps hours", () => {
  assert.equal(
    buildPerfMetricsUrl("https://api.67.si", 24),
    "https://api.67.si/api/perf-metrics/summary?hours=24"
  );
  assert.equal(clampPerfMetricsHours(undefined), PERF_METRICS_DEFAULT_HOURS);
  assert.equal(clampPerfMetricsHours("48"), 48);
  assert.equal(clampPerfMetricsHours("0"), 1);
  assert.equal(clampPerfMetricsHours("9999"), PERF_METRICS_MAX_HOURS);
  assert.equal(clampPerfMetricsHours("abc"), PERF_METRICS_DEFAULT_HOURS);
});

test("maps success rate to bar tones", () => {
  assert.equal(successRateTone(100), "ok");
  assert.equal(successRateTone(90), "ok");
  assert.equal(successRateTone(89.9), "warn");
  assert.equal(successRateTone(50), "warn");
  assert.equal(successRateTone(49.9), "bad");
  assert.equal(successRateTone(0), "bad");
  assert.equal(successRateTone(null), "unknown");
});
