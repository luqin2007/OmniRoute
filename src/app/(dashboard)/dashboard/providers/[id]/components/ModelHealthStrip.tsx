"use client";

/**
 * Inline health line for a single model row.
 *
 * Everything here is reported BY THE PROVIDER'S GATEWAY (`/api/perf-metrics/summary`), never
 * measured by OmniRoute — hence the muted styling and the "gateway" tooltip rather than the
 * usual call-stats affordances. Latency / throughput / success rate stay as text; only the
 * last-8-hours trend is graphical (one bar per hour, green / amber / red).
 */

import { PERF_METRICS_TREND_BUCKETS, successRateTone } from "@/lib/providers/perfMetrics";
import type { PerfMetricsBucket } from "@/lib/providers/perfMetrics";
import type { ModelHealthMetric } from "@/lib/providers/modelHealthIndex";
import { providerText } from "../providerPageHelpers";

type Translator = (key: string, values?: Record<string, unknown>) => string;

const TONE_COLORS: Record<ReturnType<typeof successRateTone>, string> = {
  ok: "#22c55e",
  warn: "#f59e0b",
  bad: "#ef4444",
  unknown: "#52525b",
};

export function formatHealthLatency(latencyMs: number | null): string {
  if (latencyMs === null) return "—";
  if (latencyMs < 1000) return `${Math.round(latencyMs)}ms`;
  if (latencyMs < 60_000) return `${(latencyMs / 1000).toFixed(1)}s`;
  return `${Math.round(latencyMs / 60_000)}min`;
}

export function formatHealthTps(tps: number | null): string {
  if (tps === null) return "—";
  return `${tps >= 100 ? Math.round(tps) : tps.toFixed(1)} tok/s`;
}

export function formatHealthRate(successRate: number | null): string {
  if (successRate === null) return "—";
  return `${successRate >= 100 ? 100 : successRate.toFixed(1)}%`;
}

function bucketTitle(bucket: PerfMetricsBucket): string {
  const rate = formatHealthRate(bucket.successRate);
  if (bucket.ts === null) return rate;
  const stamp = new Date(bucket.ts * 1000).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  });
  return `${stamp} · ${rate}`;
}

export function HealthTrendBars({ trend }: { trend: PerfMetricsBucket[] }) {
  const visible = trend.slice(-PERF_METRICS_TREND_BUCKETS);
  const pad = Math.max(0, PERF_METRICS_TREND_BUCKETS - visible.length);

  return (
    <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
      {Array.from({ length: pad }).map((_, index) => (
        <span
          key={`pad-${index}`}
          className="inline-block h-[3px] w-[3px] rounded-sm opacity-30"
          style={{ backgroundColor: "var(--color-border, #3f3f46)" }}
        />
      ))}
      {visible.map((bucket, index) => {
        const tone = successRateTone(bucket.successRate);
        return (
          <span
            key={index}
            title={bucketTitle(bucket)}
            className="inline-block w-[3px] rounded-sm"
            style={{
              height: 4 + Math.round((bucket.successRate / 100) * 10),
              backgroundColor: TONE_COLORS[tone],
            }}
          />
        );
      })}
    </span>
  );
}

export default function ModelHealthStrip({
  metric,
  t,
}: {
  metric: ModelHealthMetric;
  t: Translator;
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-6 text-[10px] text-text-muted"
      title={providerText(
        t,
        "perfMetricsHint",
        "Self-reported by the provider's own gateway, not measured by OmniRoute. Each bar is one success-rate bucket, oldest on the left."
      )}
    >
      <span className="font-mono">{formatHealthLatency(metric.latencyMs)}</span>
      <span className="opacity-40">·</span>
      <span className="font-mono">{formatHealthTps(metric.tps)}</span>
      <span className="opacity-40">·</span>
      <span
        className="font-mono"
        style={{ color: TONE_COLORS[successRateTone(metric.successRate)] }}
      >
        {formatHealthRate(metric.successRate)}
      </span>
      <span className="ml-auto shrink-0">
        <HealthTrendBars trend={metric.trend} />
      </span>
    </div>
  );
}
