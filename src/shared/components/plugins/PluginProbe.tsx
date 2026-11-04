"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "next-intl";
import type { PluginProbeResult, PluginWidgetContext, PluginWidgetSpec } from "./types";

type ProbeWidget = Extract<PluginWidgetSpec, { type: "probeAction" }>;

const MAX_ITEMS = 20;
const MAX_TEXT = 400;

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Narrow an untrusted plugin reply to the whitelisted result shape.
 *
 * The plugin is trusted local code, but it is still a separate process: only the
 * fields declared here are read, everything else is dropped, and every string is
 * length-capped. Nothing is ever rendered as HTML.
 */
function normalizeResult(raw: unknown): PluginProbeResult {
  const source = (raw ?? {}) as Record<string, unknown>;
  const result: PluginProbeResult = {};

  const title = text(source.title, 200);
  if (title) result.title = title;
  if (
    source.tone === "neutral" ||
    source.tone === "info" ||
    source.tone === "success" ||
    source.tone === "warn" ||
    source.tone === "error"
  ) {
    result.tone = source.tone;
  }

  if (Array.isArray(source.summary)) {
    const summary = source.summary
      .slice(0, MAX_ITEMS)
      .map((item) => {
        const entry = (item ?? {}) as Record<string, unknown>;
        const label = text(entry.label, 80);
        const value = text(entry.value, 200);
        return label && value ? { label, value } : null;
      })
      .filter((item): item is { label: string; value: string } => item !== null);
    if (summary.length > 0) result.summary = summary;
  }

  const table = (source.table ?? null) as Record<string, unknown> | null;
  if (table && Array.isArray(table.columns) && Array.isArray(table.rows)) {
    const columns = table.columns
      .slice(0, 8)
      .map((column) => text(column, 60))
      .filter((column): column is string => Boolean(column));
    if (columns.length > 0) {
      const rows = table.rows
        .slice(0, 50)
        .map((row) =>
          Array.isArray(row)
            ? columns.map((_, index) => text(row[index], 300) ?? "—")
            : columns.map(() => "—")
        );
      result.table = { columns, rows };
    }
  }

  if (Array.isArray(source.notes)) {
    const notes = source.notes
      .slice(0, 10)
      .map((note) => text(note, MAX_TEXT))
      .filter((note): note is string => Boolean(note));
    if (notes.length > 0) result.notes = notes;
  }

  const error = text(source.error, 1000);
  if (error) result.error = error;

  return result;
}

function ResultTable({ table }: { table: NonNullable<PluginProbeResult["table"]> }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-text-muted">
            {table.columns.map((column) => (
              <th key={column} className="px-2 py-1.5 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-t border-black/[0.06] transition-colors hover:bg-black/[0.03] dark:border-white/10"
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-2 py-1.5 ${cellIndex === 0 ? "font-mono text-text-muted" : "text-text-main"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProbeDialog({
  widget,
  busy,
  error,
  result,
  onClose,
  onRetry,
}: {
  widget: ProbeWidget;
  busy: boolean;
  error: string | null;
  result: PluginProbeResult | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const heading = widget.title ?? widget.label;
  // The host owns these strings, so they follow the dashboard locale. Plugin
  // labels (button / dialog title) stay in the plugin's own wording.
  const locale = useLocale();
  const zh = locale.toLowerCase().startsWith("zh");
  const copy = {
    close: zh ? "关闭" : "Close",
    running: zh ? "正在检测…" : "Running probe…",
    failed: zh ? "无法运行检测" : "Cannot run probe",
    again: zh ? "再试一次" : "Run again",
    done: zh ? "完成" : "Done",
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#111827]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/10 px-5 py-3.5 dark:border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-primary">
              {widget.icon ?? "fingerprint"}
            </span>
            <h2 className="text-sm font-semibold text-text-main">{heading}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="rounded p-0.5 text-text-muted transition-colors hover:bg-black/5 hover:text-text-main dark:hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {busy ? (
            <div className="space-y-2" aria-busy="true">
              <p className="text-xs text-text-muted">{copy.running}</p>
              {[0, 1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="h-8 animate-pulse rounded-control bg-black/5 dark:bg-white/10"
                />
              ))}
            </div>
          ) : null}

          {!busy && error ? (
            <div className="rounded-control border border-red-500/20 bg-red-500/10 px-4 py-3">
              <p className="text-sm font-medium text-red-600">{copy.failed}</p>
              <p className="mt-0.5 text-xs text-red-600/80">{error}</p>
            </div>
          ) : null}

          {!busy && !error && result ? (
            <div className="space-y-4">
              {result.title ? (
                <p className="text-sm font-semibold text-text-main">{result.title}</p>
              ) : null}
              {result.error ? (
                <p className="rounded-control bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  {result.error}
                </p>
              ) : null}
              {result.summary ? (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {result.summary.map((item) => (
                    <div
                      key={`${item.label}-${item.value}`}
                      className="rounded-control bg-black/[0.03] px-3 py-2 dark:bg-white/5"
                    >
                      <dt className="text-[10px] uppercase tracking-wide text-text-muted">
                        {item.label}
                      </dt>
                      <dd className="mt-0.5 text-sm font-medium text-text-main">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {result.table ? <ResultTable table={result.table} /> : null}
              {result.notes?.length ? (
                <ul className="space-y-1 text-[11px] leading-relaxed text-text-muted">
                  {result.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/10 px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className="rounded-control border border-black/10 px-3 py-1.5 text-xs font-medium text-text-main transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:hover:bg-white/10"
          >
            {copy.again}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90"
          >
            {copy.done}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * A row-level action contributed by a plugin.
 *
 * Clicking it opens a host-rendered dialog and calls the plugin endpoint with the
 * slot context merged into the body — so "measure this model" needs no plugin
 * code in the browser and no access to the row's internals.
 */
export function ProbeAction({
  widget,
  context,
}: {
  widget: ProbeWidget;
  context?: PluginWidgetContext;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PluginProbeResult | null>(null);

  const requestInit = useMemo(() => {
    const body = { ...(context ?? {}), ...(widget.payload ?? {}) };
    if (widget.method === "GET") {
      const query = new URLSearchParams(
        Object.entries(body).map(([key, value]) => [key, String(value)])
      ).toString();
      return {
        url: query ? `${widget.endpoint}?${query}` : widget.endpoint,
        init: { cache: "no-store" as RequestCache },
      };
    }
    return {
      url: widget.endpoint,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      } as RequestInit,
    };
  }, [context, widget.endpoint, widget.method, widget.payload]);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(requestInit.url, requestInit.init);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          (payload as { error?: { message?: string } } | null)?.error?.message ??
          `Request failed (${response.status})`;
        throw new Error(message);
      }
      setResult(normalizeResult(payload));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [requestInit]);

  const start = useCallback(() => {
    setOpen(true);
    void run();
  }, [run]);

  const icon = widget.icon ?? "fingerprint";

  return (
    <>
      {widget.iconOnly ? (
        <button
          type="button"
          onClick={start}
          title={widget.title ?? widget.label}
          aria-label={widget.label}
          className="rounded p-0.5 text-text-muted transition-colors hover:bg-sidebar hover:text-primary"
        >
          <span className="material-symbols-outlined text-sm">{icon}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          className={`inline-flex items-center gap-1.5 self-start rounded-control px-3 py-1.5 text-xs font-medium transition-colors ${
            widget.tone === "primary"
              ? "bg-primary text-white hover:bg-primary/90"
              : "border border-black/10 text-text-main hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">{icon}</span>
          {widget.label}
        </button>
      )}

      {open ? (
        <ProbeDialog
          widget={widget}
          busy={busy}
          error={error}
          result={result}
          onClose={() => setOpen(false)}
          onRetry={() => void run()}
        />
      ) : null}
    </>
  );
}
