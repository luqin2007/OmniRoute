"use client";

/**
 * ProviderModelHealthPanel — "Refresh health" for the provider's OWN gateway numbers.
 *
 * Renders the model health that the upstream gateway publishes at
 * `/api/perf-metrics/summary` (NewAPI-style deployments). Nothing on this panel is measured
 * by OmniRoute: latency, throughput and success rate are the provider's claims, which is why
 * the panel is labelled and hinted as such and never mixed with OmniRoute's own call stats.
 *
 * Idle until the operator clicks: a provider that does not expose the endpoint costs nothing
 * until someone asks for it.
 */

import { useCallback, useState } from "react";
import { ActionBar, Button } from "@/shared/components";
import {
  PERF_METRICS_TREND_BUCKETS,
  successRateTone,
  type ModelHealthResponse,
  type ModelHealthSource,
  type PerfMetricsBucket,
  type PerfMetricsModel,
} from "@/lib/providers/perfMetrics";
import { providerText, type ProviderMessageTranslator } from "../providerPageHelpers";

export interface ProviderModelHealthPanelProps {
  providerId: string;
  hours?: number;
  t: ProviderMessageTranslator;
}

type PanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ModelHealthResponse };

const TONE_COLORS: Record<ReturnType<typeof successRateTone>, string> = {
  ok: "#22c55e",
  warn: "#f59e0b",
  bad: "#ef4444",
  unknown: "#52525b",
};

function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) return "—";
  if (latencyMs < 1000) return `${Math.round(latencyMs)}ms`;
  if (latencyMs < 60_000) return `${(latencyMs / 1000).toFixed(1)}s`;
  return `${Math.round(latencyMs / 60_000)}min`;
}

function formatTps(tps: number | null): string {
  if (tps === null) return "—";
  return `${tps >= 100 ? Math.round(tps) : tps.toFixed(1)} tok/s`;
}

function formatRate(successRate: number | null): string {
  if (successRate === null) return "—";
  return `${successRate >= 100 ? 100 : successRate.toFixed(1)}%`;
}

function formatBucket(bucket: PerfMetricsBucket): string {
  const rate = formatRate(bucket.successRate);
  if (bucket.ts === null) return rate;
  const label = new Date(bucket.ts * 1000).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  });
  return `${label} · ${rate}`;
}

function TrendBars({ trend }: { trend: PerfMetricsBucket[] }) {
  const padded: Array<PerfMetricsBucket | null> = [
    ...Array<null>(Math.max(0, PERF_METRICS_TREND_BUCKETS - trend.length)).fill(null),
    ...trend.slice(-PERF_METRICS_TREND_BUCKETS),
  ];

  return (
    <span className="inline-flex items-end gap-[3px]" aria-hidden="true">
      {padded.map((bucket, index) => {
        const tone = bucket ? successRateTone(bucket.successRate) : "unknown";
        return (
          <span
            key={index}
            title={bucket ? formatBucket(bucket) : undefined}
            className="inline-block w-[4px] rounded-sm"
            style={{
              height: bucket ? 4 + Math.round((bucket.successRate / 100) * 14) : 4,
              backgroundColor: bucket ? TONE_COLORS[tone] : "var(--color-border, #3f3f46)",
              opacity: bucket ? 1 : 0.4,
            }}
          />
        );
      })}
    </span>
  );
}

function SourceTable({
  source,
  t,
}: {
  source: ModelHealthSource & { report: NonNullable<ModelHealthSource["report"]> };
  t: ProviderMessageTranslator;
}) {
  const { report } = source;
  const summary = report.summary;

  return (
    <div className="mb-5 last:mb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <span className="text-[13px] font-medium text-text-main">{source.origin}</span>
        {summary && (
          <span className="text-xs text-text-muted">
            {providerText(t, "perfMetricsAggregate", "{latency} · {rate} success · {tps}", {
              latency: formatLatency(summary.latencyMs),
              rate: formatRate(summary.successRate),
              tps: formatTps(summary.tps),
            })}
          </span>
        )}
        {report.windowEnd !== null && (
          <span className="text-[11px] text-text-muted">
            {providerText(t, "perfMetricsFetchedAt", "as of {time}", {
              time: new Date(report.windowEnd * 1000).toLocaleString(),
            })}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="px-3 py-2 font-medium">
                {providerText(t, "perfMetricsColModel", "Model")}
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                {providerText(t, "perfMetricsColLatency", "Latency")}
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                {providerText(t, "perfMetricsColTps", "Throughput")}
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                {providerText(t, "perfMetricsColSuccess", "Success")}
              </th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">
                {providerText(t, "perfMetricsColTrend", "Last 8h")}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.models.map((model: PerfMetricsModel) => (
              <tr key={model.model} className="border-t border-border">
                <td className="px-3 py-1.5 text-text-main break-all">{model.model}</td>
                <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">
                  {formatLatency(model.latencyMs)}
                </td>
                <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">
                  {formatTps(model.tps)}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span style={{ color: TONE_COLORS[successRateTone(model.successRate)] }}>
                    {formatRate(model.successRate)}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  <TrendBars trend={model.trend} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ProviderModelHealthPanel({
  providerId,
  hours = 24,
  t,
}: ProviderModelHealthPanelProps) {
  const [state, setState] = useState<PanelState>({ status: "idle" });

  const refresh = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch(
        `/api/providers/${encodeURIComponent(providerId)}/model-health?hours=${hours}`,
        { cache: "no-store" }
      );

      if (response.status === 401 || response.status === 403) {
        setState({
          status: "error",
          message: providerText(t, "perfMetricsAuthRequired", "Session expired — sign in again"),
        });
        return;
      }

      if (!response.ok) {
        setState({
          status: "error",
          message: providerText(t, "perfMetricsFailed", "Request failed"),
        });
        return;
      }

      const data = (await response.json()) as ModelHealthResponse;
      setState({ status: "ready", data });
    } catch {
      setState({
        status: "error",
        message: providerText(t, "perfMetricsFailed", "Request failed"),
      });
    }
  }, [hours, providerId, t]);

  const button = (
    <ActionBar align="start" className="mb-3">
      <Button
        size="sm"
        variant="secondary"
        icon="monitor_heart"
        onClick={refresh}
        disabled={state.status === "loading"}
      >
        {state.status === "loading"
          ? providerText(t, "perfMetricsLoading", "Reading model health from the gateway…")
          : providerText(t, "perfMetricsRefresh", "Refresh health")}
      </Button>
    </ActionBar>
  );

  if (state.status === "idle") return <div>{button}</div>;

  if (state.status === "loading") {
    return (
      <div>
        {button}
        <p className="text-xs text-text-muted">
          {providerText(t, "perfMetricsLoading", "Reading model health from the gateway…")}
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        {button}
        <p className="text-xs text-red-600 dark:text-red-400">
          {providerText(t, "perfMetricsUnavailable", "Could not read model health: {error}", {
            error: state.message,
          })}
        </p>
      </div>
    );
  }

  const okSources = state.data.sources.filter(
    (source): source is ModelHealthSource & { report: NonNullable<ModelHealthSource["report"]> } =>
      source.ok && source.report !== null
  );
  const failure = state.data.sources.find((source) => !source.ok) ?? null;

  return (
    <div>
      {button}
      <div className="mb-2">
        <span className="text-[13px] font-semibold text-text-main">
          {providerText(t, "perfMetricsTitle", "Gateway-reported model health")}
        </span>
      </div>

      {okSources.length === 0 ? (
        <p className="text-xs text-text-muted">
          {failure
            ? providerText(t, "perfMetricsUnavailable", "Could not read model health: {error}", {
                error: `${failure.origin} — ${failure.error ?? ""}`.trim(),
              })
            : providerText(
                t,
                "perfMetricsEmpty",
                "The gateway did not report any model health for this window."
              )}
        </p>
      ) : (
        <>
          <div className="max-h-[420px] overflow-y-auto pr-1">
            {okSources.map((source) => (
              <SourceTable key={source.origin} source={source} t={t} />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {providerText(
              t,
              "perfMetricsHint",
              "Self-reported by the provider's own gateway, not measured by OmniRoute. Each bar is one success-rate bucket, oldest on the left."
            )}
          </p>
        </>
      )}
    </div>
  );
}
