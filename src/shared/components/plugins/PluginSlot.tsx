"use client";

import { PluginWidget } from "./PluginWidgets";
import { usePluginSlot } from "./PluginContributionsProvider";
import type { PluginWidgetContext } from "./types";

/**
 * Injection point reserved by the host inside an existing screen.
 *
 * Renders nothing at all when no active plugin contributes to `name` — no
 * wrapper div, no gap — so a dashboard running without plugins is byte-for-byte
 * the upstream layout.
 *
 * `context` is the host's description of where the slot sits (row ids, model id,
 * full model string). It is only ever forwarded to probe widgets, so a slot's
 * added markup stays empty when no contribution declares one.
 */
export function PluginSlot({
  name,
  variant = "block",
  context,
}: {
  name: string;
  /** `inline` keeps the widgets in the parent's flex row; `block` stacks them. */
  variant?: "inline" | "block";
  context?: PluginWidgetContext;
}) {
  const entries = usePluginSlot(name);
  if (entries.length === 0) return null;

  if (variant === "inline") {
    return (
      <>
        {entries.map((entry, index) => (
          <PluginWidget
            key={`${entry.plugin}-${entry.widget.type}-${index}`}
            widget={entry.widget}
            plugin={entry.plugin}
            context={context}
          />
        ))}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, index) => (
        <PluginWidget
          key={`${entry.plugin}-${entry.widget.type}-${index}`}
          widget={entry.widget}
          plugin={entry.plugin}
          context={context}
        />
      ))}
    </div>
  );
}
