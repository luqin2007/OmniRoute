"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/shared/components";
import { PluginWidget } from "@/shared/components/plugins/PluginWidgets";
import type { PluginWidgetSpec } from "@/shared/components/plugins/types";

interface PluginPageData {
  plugin: string;
  pageId: string;
  titleFallback: string;
  descriptionFallback?: string;
  widgets: PluginWidgetSpec[];
}

type ProviderNode = { id: string; prefix?: string | null; name?: string | null };

interface Summary {
  total: number;
  distinctPrefixes: number;
  updatedAt: string;
}

function SummaryCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-control border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text-main">{value}</p>
    </div>
  );
}

export default function PluginPageClient({ data }: { data: PluginPageData }) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  const tableWidget = useMemo(
    () => data.widgets.find((widget) => widget.type === "providerNodeTable"),
    [data.widgets]
  );

  const prefixRoot = tableWidget?.type === "providerNodeTable" ? tableWidget.prefixRoot : undefined;

  useEffect(() => {
    if (!prefixRoot) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/provider-nodes", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("provider_nodes_unavailable");
        const payload = await response.json();
        const all: ProviderNode[] = Array.isArray(payload?.nodes) ? payload.nodes : [];
        const mine = all.filter((node) =>
          (node.prefix ?? "").toLowerCase().startsWith(prefixRoot.toLowerCase())
        );
        if (controller.signal.aborted) return;
        setSummary({
          total: mine.length,
          distinctPrefixes: new Set(mine.map((node) => node.prefix ?? "")).size,
          updatedAt: new Date().toLocaleTimeString(),
        });
      } catch {
        if (!controller.signal.aborted) setSummary(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [prefixRoot]);

  const handleRefresh = useCallback(() => {
    router.refresh();
    setSummary((current) =>
      current ? { ...current, updatedAt: new Date().toLocaleTimeString() } : current
    );
  }, [router]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-main">{data.titleFallback}</h1>
            <span className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] font-medium text-text-muted dark:border-white/15">
              {data.plugin}
            </span>
          </div>
          {data.descriptionFallback ? (
            <p className="mt-1 max-w-2xl text-sm text-text-muted">{data.descriptionFallback}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center gap-1.5 rounded-control border border-black/10 px-3 py-1.5 text-xs font-medium text-text-main transition-colors hover:bg-black/5 dark:border-white/15"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Refresh
        </button>
      </div>

      {summary || loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard
            value={loading && !summary ? "—" : String(summary?.total ?? 0)}
            label="Nodes provisioned"
          />
          <SummaryCard
            value={loading && !summary ? "—" : String(summary?.distinctPrefixes ?? 0)}
            label="Distinct prefixes"
          />
          <SummaryCard value={summary?.updatedAt ?? "—"} label="Last synced" />
        </div>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-col gap-4">
          {data.widgets.map((widget, index) => (
            <PluginWidget key={`${widget.type}-${index}`} widget={widget} plugin={data.plugin} />
          ))}
        </div>
      </Card>
    </div>
  );
}
