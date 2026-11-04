"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PluginWidgetContext, PluginWidgetSpec } from "./types";
import { ProbeAction } from "./PluginProbe";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-black/5 text-text-muted border-black/10",
  success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  warn: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  error: "bg-red-500/10 text-red-600 border-red-500/20",
  info: "bg-blue-500/10 text-blue-600 border-blue-500/20",
};

type ProviderNodeRow = {
  id: string;
  name?: string | null;
  prefix?: string | null;
  type?: string | null;
  baseUrl?: string | null;
};

function ProviderNodeTable({ prefixRoot, emptyHint }: { prefixRoot?: string; emptyHint?: string }) {
  const [nodes, setNodes] = useState<ProviderNodeRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/provider-nodes", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("provider_nodes_unavailable");
        const payload = await response.json();
        const all: ProviderNodeRow[] = Array.isArray(payload?.nodes) ? payload.nodes : [];
        const filtered = prefixRoot
          ? all.filter((node) =>
              (node.prefix ?? "").toLowerCase().startsWith(prefixRoot.toLowerCase())
            )
          : all;
        if (!controller.signal.aborted) setNodes(filtered);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [prefixRoot]);

  if (failed) {
    return <p className="text-sm text-text-muted">Provider nodes are unavailable right now.</p>;
  }

  if (nodes === null) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-9 animate-pulse rounded-control bg-black/5" />
        ))}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="rounded-control border border-dashed border-black/15 p-6 text-center">
        <p className="text-sm font-medium text-text-main">No nodes provisioned yet</p>
        <p className="mt-1 text-xs text-text-muted">
          {emptyHint ?? `Run the plugin's provision step to create ${prefixRoot ?? ""} nodes.`}
        </p>
      </div>
    );
  }

  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted">
            <th className="px-2 py-2 font-medium">Node</th>
            <th className="px-2 py-2 font-medium">Prefix</th>
            <th className="px-2 py-2 font-medium">Type</th>
            <th className="px-2 py-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr
              key={node.id}
              className="border-t border-black/[0.06] transition-colors hover:bg-black/[0.03]"
            >
              <td className="px-2 py-2 font-medium text-text-main">{node.name ?? node.id}</td>
              <td className="px-2 py-2 font-mono text-xs text-text-muted">{node.prefix ?? "—"}</td>
              <td className="px-2 py-2 text-xs text-text-muted">
                {node.type ?? "openai-compatible"}
              </td>
              <td className="px-2 py-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  ready
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionButton({
  widget,
  plugin,
}: {
  widget: Extract<PluginWidgetSpec, { type: "actionButton" }>;
  plugin: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const primary = widget.tone === "primary";

  const baseClass = primary
    ? "bg-primary text-white hover:bg-primary/90"
    : "border border-black/10 text-text-main hover:bg-black/5";

  const onClick = useCallback(async () => {
    if (widget.action === "refresh") {
      router.refresh();
      return;
    }
    if (widget.action === "syncProviderNodes") {
      setBusy(true);
      try {
        await fetch(`/api/plugins/${encodeURIComponent(plugin)}/providers/sync`, {
          method: "POST",
        });
        router.refresh();
      } finally {
        setBusy(false);
      }
    }
  }, [plugin, router, widget.action]);

  if (widget.action === "navigate" && widget.href) {
    return (
      <Link
        href={widget.href}
        className={`inline-flex items-center rounded-control px-3 py-1.5 text-xs font-medium transition-colors ${baseClass}`}
      >
        {widget.label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center rounded-control px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${baseClass}`}
    >
      {busy ? "Working…" : widget.label}
    </button>
  );
}

/**
 * Renders one contributed widget. Unknown types render nothing — the server
 * validates against the same closed union, so this is belt-and-braces.
 */
export function PluginWidget({
  widget,
  plugin,
  context,
}: {
  widget: PluginWidgetSpec;
  plugin: string;
  /** Slot-provided row context (providerId, modelId, …), forwarded to probe endpoints. */
  context?: PluginWidgetContext;
}) {
  switch (widget.type) {
    case "providerNodeTable":
      return <ProviderNodeTable prefixRoot={widget.prefixRoot} emptyHint={widget.emptyHint} />;

    case "keyValue":
      return (
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {widget.items.map((item) => (
            <div
              key={`${item.label}-${item.value}`}
              className="rounded-control bg-black/[0.03] px-3 py-2"
            >
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">{item.label}</dt>
              <dd className="mt-0.5 text-sm font-medium text-text-main">{item.value}</dd>
            </div>
          ))}
        </dl>
      );

    case "markdown":
      return (
        <div className="space-y-2 whitespace-pre-wrap text-sm leading-relaxed text-text-main">
          {widget.text}
        </div>
      );

    case "callout":
      return (
        <div
          className={`rounded-control border px-4 py-3 ${TONE_CLASS[widget.tone] ?? TONE_CLASS.info}`}
        >
          <p className="text-sm font-medium">{widget.title}</p>
          <p className="mt-0.5 text-xs opacity-80">{widget.text}</p>
        </div>
      );

    case "statusBadge":
      return (
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[widget.tone] ?? TONE_CLASS.neutral}`}
        >
          {widget.label}
        </span>
      );

    case "actionButton":
      return <ActionButton widget={widget} plugin={plugin} />;

    case "probeAction":
      return <ProbeAction widget={widget} context={context} />;

    default:
      return null;
  }
}
