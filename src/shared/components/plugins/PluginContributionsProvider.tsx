"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EMPTY_PLUGIN_CONTRIBUTIONS, type PluginContributionsPayload } from "./types";

const PluginContributionsContext = createContext<PluginContributionsPayload>(
  EMPTY_PLUGIN_CONTRIBUTIONS
);

/**
 * Carries the server-aggregated plugin contributions down the dashboard tree.
 *
 * Provided once by `(dashboard)/layout.tsx`, so the sidebar, the providers page,
 * the API-key list and every `<PluginSlot>` read the same snapshot without any
 * extra request. With no active plugin the value is the empty payload and every
 * consumer renders exactly what the upstream release renders.
 */
export function PluginContributionsProvider({
  value,
  children,
}: {
  value: PluginContributionsPayload;
  children: ReactNode;
}) {
  return (
    <PluginContributionsContext.Provider value={value}>
      {children}
    </PluginContributionsContext.Provider>
  );
}

export function usePluginContributions(): PluginContributionsPayload {
  return useContext(PluginContributionsContext);
}

/** Widgets contributed to one named slot, flattened across plugins. */
export function usePluginSlot(name: string) {
  const contributions = usePluginContributions();
  return contributions.slots
    .filter((slot) => slot.name === name)
    .flatMap((slot) => slot.widgets.map((widget) => ({ widget, plugin: slot.plugin })));
}
