/**
 * Model-id lookup for gateway-reported health.
 *
 * The provider's health endpoint reports bare model ids (`openai/gpt-oss-120b`) while the
 * dashboard lists models under its own namespace (`pomodoro/openai/gpt-oss-120b`), and a
 * provider may answer from more than one gateway origin. This module turns the per-origin
 * reports into ONE index keyed by model id so a row can ask "what is my health?" without
 * knowing which gateway answered.
 *
 * Pure — no fetch, no React.
 */

import type { ModelHealthSource, PerfMetricsBucket } from "./perfMetrics";

export interface ModelHealthMetric {
  /** Model id exactly as the gateway reported it. */
  model: string;
  /** Gateway origin the numbers came from. */
  origin: string;
  latencyMs: number | null;
  tps: number | null;
  successRate: number | null;
  /** Last N hourly buckets, oldest first. */
  trend: PerfMetricsBucket[];
}

export type ModelHealthIndex = Map<string, ModelHealthMetric>;

/** Case-insensitive, whitespace-trimmed, without a leading `models/` segment. */
export function normalizeModelKey(modelId: string): string {
  let key = modelId.trim().toLowerCase();
  if (key.startsWith("models/")) key = key.slice("models/".length);
  return key;
}

/**
 * Build one index from every gateway that answered.
 *
 * Order matters: the first origin to report a model wins, so the panel keeps showing a stable
 * source instead of flickering between two gateways that disagree.
 */
export function buildModelHealthIndex(
  sources: ModelHealthSource[] | null | undefined
): ModelHealthIndex {
  const index: ModelHealthIndex = new Map();
  for (const source of sources ?? []) {
    if (!source?.ok || !source.report) continue;
    for (const model of source.report.models) {
      const key = normalizeModelKey(model.model);
      if (!key || index.has(key)) continue;
      index.set(key, {
        model: model.model,
        origin: source.origin,
        latencyMs: model.latencyMs,
        tps: model.tps,
        successRate: model.successRate,
        trend: model.trend,
      });
    }
  }
  return index;
}

/**
 * Resolve a row's health.
 *
 * Exact id first (the common case), then a suffix match in either direction so a namespaced row
 * (`vendor/model`) still finds a bare gateway id (`model`) and vice versa. Only one `/` boundary
 * away, never a substring match — `gpt-4o` must not match `gpt-4o-mini`.
 */
export function lookupModelHealth(
  index: ModelHealthIndex | null | undefined,
  modelId: string
): ModelHealthMetric | null {
  if (!index || index.size === 0) return null;
  const key = normalizeModelKey(modelId);
  if (!key) return null;

  const exact = index.get(key);
  if (exact) return exact;

  for (const [candidate, metric] of index) {
    if (candidate.endsWith(`/${key}`) || key.endsWith(`/${candidate}`)) return metric;
  }
  return null;
}
