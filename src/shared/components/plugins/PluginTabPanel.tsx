"use client";

import { PluginWidget } from "./PluginWidgets";
import type { PluginTabContribution, PluginWidgetContext } from "./types";

/**
 * Body of a plugin-contributed tab inside a host screen (today: Playground).
 *
 * The host owns the frame — heading, plugin badge, spacing — and renders only
 * whitelisted widgets inside it. `context` carries the screen's current
 * selection (model, base URL, …) so a widget can act on it without reading the
 * host's React state.
 */
export function PluginTabPanel({
  tab,
  context,
}: {
  tab: PluginTabContribution;
  context?: PluginWidgetContext;
}) {
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <header className="flex flex-wrap items-center gap-2">
        <span className="material-symbols-outlined text-[20px] text-primary">
          {tab.icon ?? "extension"}
        </span>
        <h2 className="text-base font-semibold text-text-main">{tab.labelFallback}</h2>
        <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted dark:border-white/15">
          {tab.plugin}
        </span>
      </header>

      <div className="mt-4 flex max-w-3xl flex-col gap-4">
        {tab.widgets.length === 0 ? (
          <p className="text-sm text-text-muted">This tab has no widgets yet.</p>
        ) : (
          tab.widgets.map((widget, index) => (
            <PluginWidget
              key={`${tab.plugin}-${widget.type}-${index}`}
              widget={widget}
              plugin={tab.plugin}
              context={context}
            />
          ))
        )}
      </div>
    </div>
  );
}
