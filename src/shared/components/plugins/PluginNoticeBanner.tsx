"use client";

/**
 * Operator notices raised by the plugin system (today: a plugin needs a host
 * binary that is not installed).
 *
 * Interaction contract, on purpose:
 * - The banner does NOT auto-dismiss. No timer, no toast, no "×" that reappears
 *   after a refresh: the server keeps the row until the operator closes it.
 * - Closing it is a DELETE, so the decision survives container restarts.
 * - It renders nothing at all when there is nothing to say, so a zero-notice
 *   install is byte-identical to the release it replaced.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export interface PluginNoticeView {
  id: string;
  pluginName: string;
  code: string;
  subject: string;
  message: string;
}

export function PluginNoticeBanner({ notices }: { notices: PluginNoticeView[] }) {
  const t = useTranslations("common");
  const router = useRouter();
  const [closing, setClosing] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  if (notices.length === 0) return null;

  const visible = notices.filter((notice) => !dismissed[notice.id]);
  if (visible.length === 0) return null;

  const close = async (id: string) => {
    setClosing((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/plugins/notices/${id}`, { method: "DELETE" });
      // A 404 means someone else already closed it — treat that as success.
      if (res.ok || res.status === 404) {
        setDismissed((prev) => ({ ...prev, [id]: true }));
        router.refresh();
      }
    } catch {
      // Keep the notice on screen: losing it silently is exactly what must not happen.
    } finally {
      setClosing((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="mb-4 flex flex-col gap-2">
      {visible.map((notice) => (
        <div
          key={notice.id}
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-700 dark:text-amber-400"
        >
          <span
            className="material-symbols-outlined mt-0.5 text-[20px] text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          >
            warning
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-main">
              {notice.pluginName}
              <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                plugin
              </span>
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{notice.message}</p>
          </div>
          <button
            type="button"
            onClick={() => void close(notice.id)}
            disabled={Boolean(closing[notice.id])}
            aria-label={t("dismissNotification")}
            title={t("dismissNotification")}
            className="shrink-0 rounded-md p-1 text-amber-700/70 transition-colors hover:bg-amber-500/20 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-400/80 dark:hover:text-amber-300"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              close
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
