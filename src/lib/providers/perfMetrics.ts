/**
 * Provider self-reported model health (`/api/perf-metrics/summary`).
 *
 * Some gateways built on NewAPI publish an aggregate performance summary of their own
 * upstream traffic: average latency, success rate, throughput, and an hourly success-rate
 * series per model. OmniRoute does not measure any of this — the numbers come from the
 * provider's dashboard and are shown next to (never merged into) OmniRoute's own
 * `call_logs` statistics.
 *
 * Two payload shapes are in the wild and both are normalised here:
 *
 *  A. newer gateways — `data.summary` + `data.window_*` + `data.models[].recent_success_series`
 *     (`[{ ts, success_rate }]`, one bucket per hour of the window)
 *  B. older gateways — `data.models[].recent_success_rates` (`[100, 99.49, 100]`, no
 *     timestamps, no window, no summary)
 *
 * Nothing here performs I/O, so the parsing rules are unit-tested directly.
 */

/** Hourly buckets rendered as the little health bars. */
export const PERF_METRICS_TREND_BUCKETS = 8;
/** Default window requested from the gateway. */
export const PERF_METRICS_DEFAULT_HOURS = 24;
/** Upper bound on `?hours=`; the gateway aggregates at most a week cheaply. */
export const PERF_METRICS_MAX_HOURS = 168;
/** Path the aggregating gateways expose next to `/v1`. */
export const PERF_METRICS_PATH = "/api/perf-metrics/summary";

export interface PerfMetricsBucket {
  /** Bucket start, seconds since epoch. `null` when the payload has no timestamps. */
  ts: number | null;
  /** Success rate in percent (`0..100`). */
  successRate: number;
}

export interface PerfMetricsModel {
  model: string;
  latencyMs: number | null;
  tps: number | null;
  successRate: number | null;
  /** Oldest bucket first, limited to the last {@link PERF_METRICS_TREND_BUCKETS}. */
  trend: PerfMetricsBucket[];
}

export interface PerfMetricsSummary {
  latencyMs: number | null;
  successRate: number | null;
  tps: number | null;
  /** True when the gateway did not send `summary` and we averaged the model rows. */
  derived: boolean;
}

export interface PerfMetricsReport {
  models: PerfMetricsModel[];
  summary: PerfMetricsSummary | null;
  /** Window start, seconds since epoch. */
  windowStart: number | null;
  /** Window end, seconds since epoch. */
  windowEnd: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function toPercent(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  return Math.min(100, Math.max(0, n));
}

function toNonNegative(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  return n < 0 ? null : n;
}

/** `[{ ts, success_rate }]` (shape A). Unknown/NaN buckets are skipped, not coerced to 0. */
function parseSeries(buckets: unknown): PerfMetricsBucket[] {
  if (!Array.isArray(buckets)) return [];
  const out: PerfMetricsBucket[] = [];
  for (const bucket of buckets) {
    if (!isRecord(bucket)) continue;
    const successRate = toPercent(bucket.success_rate);
    if (successRate === null) continue;
    out.push({ ts: toFiniteNumber(bucket.ts), successRate });
  }
  return out;
}

/** `[100, 99.49]` (shape B) — positional, no timestamps. */
function parseRateList(values: unknown): PerfMetricsBucket[] {
  if (!Array.isArray(values)) return [];
  const out: PerfMetricsBucket[] = [];
  for (const value of values) {
    const successRate = toPercent(value);
    if (successRate === null) continue;
    out.push({ ts: null, successRate });
  }
  return out;
}

/**
 * Pick the per-model hourly series out of a model row.
 *
 * `recent_success_series` wins when both are present: it carries timestamps, so the bars can
 * be labelled and ordered. Falls back to the positional list.
 */
function parseTrend(row: Record<string, unknown>): PerfMetricsBucket[] {
  const series = parseSeries(row.recent_success_series);
  const trend = series.length > 0 ? series : parseRateList(row.recent_success_rates);
  return trend.slice(-PERF_METRICS_TREND_BUCKETS);
}

function parseModelRow(row: unknown): PerfMetricsModel | null {
  if (!isRecord(row)) return null;
  const model = typeof row.model_name === "string" ? row.model_name.trim() : "";
  if (!model) return null;
  return {
    model,
    latencyMs: toNonNegative(row.avg_latency_ms),
    tps: toNonNegative(row.avg_tps),
    successRate: toPercent(row.success_rate),
    trend: parseTrend(row),
  };
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function parseSummary(raw: unknown): PerfMetricsSummary | null {
  if (!isRecord(raw)) return null;
  const summary: PerfMetricsSummary = {
    latencyMs: toNonNegative(raw.avg_latency_ms),
    successRate: toPercent(raw.success_rate),
    tps: toNonNegative(raw.avg_tps),
    derived: false,
  };
  if (summary.latencyMs === null && summary.successRate === null && summary.tps === null) {
    return null;
  }
  return summary;
}

/**
 * Shape B sends no `summary`; the panel still wants one headline number set, so average the
 * model rows and flag the result as derived.
 */
function deriveSummary(models: PerfMetricsModel[]): PerfMetricsSummary | null {
  if (models.length === 0) return null;
  return {
    latencyMs: mean(models.map((model) => model.latencyMs)),
    successRate: mean(models.map((model) => model.successRate)),
    tps: mean(models.map((model) => model.tps)),
    derived: true,
  };
}

function parseWindow(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n !== null && n > 0 ? n : null;
}

/**
 * Normalise a `/api/perf-metrics/summary` body.
 *
 * Returns `null` when the body is not a summary we understand (wrong shape, wrapped in an
 * error envelope, empty model list) so the caller can report "the gateway did not report
 * anything" instead of rendering a fake all-zero table.
 */
export function normalizePerfMetricsPayload(body: unknown): PerfMetricsReport | null {
  if (!isRecord(body)) return null;
  const data = isRecord(body.data) ? body.data : body;
  if (body.success === false) return null;

  const rawModels = Array.isArray(data.models) ? data.models : [];
  const models: PerfMetricsModel[] = [];
  const seen = new Set<string>();
  for (const row of rawModels) {
    const model = parseModelRow(row);
    if (!model) continue;
    // Gateways can repeat a model across buckets (multi-key setups); keep the first row so the
    // table never shows the same name twice.
    if (seen.has(model.model)) continue;
    seen.add(model.model);
    models.push(model);
  }

  if (models.length === 0) return null;

  const summary = parseSummary(data.summary) ?? deriveSummary(models);
  return {
    models,
    summary,
    windowStart: parseWindow(data.window_start),
    windowEnd: parseWindow(data.window_end),
  };
}

/**
 * Origin (`scheme://host[:port]`) of a provider base URL — the perf-metrics endpoint lives at
 * the gateway root, not under `/v1`, so a base URL ending in `/v1` or `/v1/` must be trimmed.
 */
export function perfMetricsOrigin(baseUrl: string | null | undefined): string | null {
  if (typeof baseUrl !== "string") return null;
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Clamp `?hours=` into the range the gateway accepts. */
export function clampPerfMetricsHours(hours: unknown): number {
  const n = toFiniteNumber(hours);
  if (n === null) return PERF_METRICS_DEFAULT_HOURS;
  return Math.min(PERF_METRICS_MAX_HOURS, Math.max(1, Math.round(n)));
}

/** `https://gateway.example` + 24 → `https://gateway.example/api/perf-metrics/summary?hours=24`. */
export function buildPerfMetricsUrl(origin: string, hours: number): string {
  return `${origin}${PERF_METRICS_PATH}?hours=${clampPerfMetricsHours(hours)}`;
}

/** One probed gateway origin and what it reported. */
export interface ModelHealthSource {
  origin: string;
  ok: boolean;
  /** Sanitized reason when `ok` is false. */
  error: string | null;
  report: PerfMetricsReport | null;
}

/** Wire shape of `GET /api/providers/{id}/model-health`. */
export interface ModelHealthResponse {
  providerId: string;
  hours: number;
  fetchedAt: string;
  cached: boolean;
  sources: ModelHealthSource[];
  /** Set when no origin could be probed at all, or every origin failed. */
  error: string | null;
}

/** Bar colour bucket: `ok` (green) / `warn` (yellow) / `bad` (red). */
export function successRateTone(successRate: number | null): "ok" | "warn" | "bad" | "unknown" {
  if (successRate === null) return "unknown";
  if (successRate >= 90) return "ok";
  if (successRate >= 50) return "warn";
  return "bad";
}
