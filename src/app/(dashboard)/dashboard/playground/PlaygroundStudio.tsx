"use client";

// src/app/(dashboard)/dashboard/playground/PlaygroundStudio.tsx

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { StreamMetrics } from "@/shared/schemas/playground";
import StudioTopBar, { type StudioTab } from "./components/StudioTopBar";
import StudioConfigPane, { type ConfigState } from "./components/StudioConfigPane";
import { DEFAULT_PARAMS } from "./components/ParamSliders";
import CompareTab from "./components/tabs/CompareTab";
import { usePluginContributions } from "@/shared/components/plugins/PluginContributionsProvider";
import { PluginTabPanel } from "@/shared/components/plugins/PluginTabPanel";

// Lazy-load tabs to reduce initial bundle size
const ChatTab = dynamic(() => import("./components/tabs/ChatTab"), { ssr: false });
const ApiTab = dynamic(() => import("./components/tabs/ApiTab"), { ssr: false });
const BuildTab = dynamic(() => import("./components/tabs/BuildTab"), { ssr: false });

const INITIAL_METRICS: StreamMetrics = {
  ttftMs: null,
  totalMs: null,
  tokensIn: 0,
  tokensOut: 0,
  tps: null,
  costUsd: null,
};

const INITIAL_CONFIG: ConfigState = {
  endpoint: "chat.completions",
  baseUrl: typeof window !== "undefined" ? window.location.origin : "http://localhost:20128",
  model: "",
  systemPrompt: "You are a helpful assistant.",
  params: DEFAULT_PARAMS,
};

const BUILTIN_TABS: StudioTab[] = ["chat", "compare", "api", "build"];

function resolveTab(value: string | null, pluginTabIds: ReadonlySet<string>): string {
  if (value && (BUILTIN_TABS.includes(value as StudioTab) || pluginTabIds.has(value))) {
    return value;
  }
  return "chat";
}

/**
 * PlaygroundStudio — orchestrator component for the Playground Studio.
 * - Manages active tab state (supports ?tab=chat|compare|api|build deep-link)
 * - Manages shared configState for all tabs
 * - Renders StudioTopBar + content + StudioConfigPane
 *
 * F7 SLOTS:
 * - SLOT_PRESETS: F7 will replace the comment in StudioConfigPane with PresetPicker
 * - SLOT_IMPROVE: F7 will replace the comment in StudioConfigPane with ImprovePromptButton
 *
 * Plugin tabs come from `contributes.tabs` with `screen: "playground"`; the host
 * renders their widgets and hands them the current model as slot context, so a
 * contributed tab can act on whatever the operator selected in the config pane.
 */
export function PlaygroundStudio() {
  const searchParams = useSearchParams();
  const contributions = usePluginContributions();
  const pluginTabs = useMemo(
    () => contributions.tabs.filter((tab) => tab.screen === "playground"),
    [contributions.tabs]
  );
  const pluginTabIds = useMemo(() => new Set(pluginTabs.map((tab) => tab.id)), [pluginTabs]);

  // Derive active tab from URL — no effect needed, avoids setState-in-effect lint violation.
  // When URL changes (client nav), searchParams updates, component re-renders with new tab.
  const activeTab: string = resolveTab(searchParams.get("tab"), pluginTabIds);
  const [manualTab, setManualTab] = useState<string | null>(null);
  const effectiveTab = manualTab ?? activeTab;
  const activePluginTab = pluginTabs.find((tab) => tab.id === effectiveTab);

  const [configState, setConfigState] = useState<ConfigState>(INITIAL_CONFIG);
  const [metrics, setMetrics] = useState<StreamMetrics>(INITIAL_METRICS);

  const tabContext = useMemo(() => {
    const model = configState.model;
    const slash = model.indexOf("/");
    return {
      baseUrl: configState.baseUrl,
      model,
      providerId: slash > 0 ? model.slice(0, slash) : model,
      modelId: slash > 0 ? model.slice(slash + 1) : "",
    };
  }, [configState.baseUrl, configState.model]);

  function handleTabChange(tab: string) {
    setManualTab(tab);
  }

  function handleMetricsUpdate(m: StreamMetrics) {
    setMetrics(m);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Top bar with tabs + token/cost counter + export button */}
      <StudioTopBar
        activeTab={effectiveTab}
        onTabChange={handleTabChange}
        metrics={metrics}
        pluginTabs={pluginTabs.map((tab) => ({
          id: tab.id,
          label: tab.labelFallback,
          icon: tab.icon,
        }))}
        exportState={{
          endpoint: configState.endpoint,
          baseUrl: configState.baseUrl,
          model: configState.model,
          systemPrompt: configState.systemPrompt,
          params: configState.params,
        }}
      />

      {/* Main content area: tab content + config pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {effectiveTab === "chat" && (
            <ChatTab configState={configState} onMetricsUpdate={handleMetricsUpdate} />
          )}
          {effectiveTab === "compare" && <CompareTab configState={configState} />}
          {effectiveTab === "api" && <ApiTab configState={configState} />}
          {effectiveTab === "build" && <BuildTab configState={configState} />}
          {activePluginTab && <PluginTabPanel tab={activePluginTab} context={tabContext} />}
        </div>

        {/* Config pane — always visible, collapsible */}
        {/* SLOT_PRESETS and SLOT_IMPROVE are inside StudioConfigPane */}
        <StudioConfigPane configState={configState} setConfigState={setConfigState} />
      </div>
    </div>
  );
}
