"use client";

/**
 * Fetches the model health the provider's own gateway reports and exposes it as a per-row
 * lookup, so the health lives ON the model rows instead of in a second table.
 *
 * Manual on purpose: nothing is fetched until the operator asks, because most providers do not
 * ship `/api/perf-metrics/summary` at all and a background poll would 404 on every one of them.
 */

import { useCallback, useMemo, useState } from "react";

import { buildModelHealthIndex, lookupModelHealth } from "@/lib/providers/modelHealthIndex";
import type { ModelHealthMetric } from "@/lib/providers/modelHealthIndex";
import type { ModelHealthResponse } from "@/lib/providers/perfMetrics";

export type ModelHealthLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; kind: "auth" | "request"; httpStatus: number | null }
  | { status: "ready"; data: ModelHealthResponse };

export interface UseProviderModelHealthResult {
  state: ModelHealthLoadState;
  /** Re-read the gateway (also used as the retry action). */
  refresh: () => Promise<void>;
  /** Health for one model id, or null when the gateway did not report it. */
  metricFor: (modelId: string) => ModelHealthMetric | null;
}

export function useProviderModelHealth(
  providerId: string,
  hours = 24
): UseProviderModelHealthResult {
  const [state, setState] = useState<ModelHealthLoadState>({ status: "idle" });

  const refresh = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch(
        `/api/providers/${encodeURIComponent(providerId)}/model-health?hours=${hours}`,
        { cache: "no-store" }
      );

      if (response.status === 401 || response.status === 403) {
        setState({ status: "error", kind: "auth", httpStatus: response.status });
        return;
      }
      if (!response.ok) {
        setState({ status: "error", kind: "request", httpStatus: response.status });
        return;
      }

      const data = (await response.json()) as ModelHealthResponse;
      setState({ status: "ready", data });
    } catch {
      setState({ status: "error", kind: "request", httpStatus: null });
    }
  }, [hours, providerId]);

  const index = useMemo(
    () => (state.status === "ready" ? buildModelHealthIndex(state.data.sources) : null),
    [state]
  );

  const metricFor = useCallback((modelId: string) => lookupModelHealth(index, modelId), [index]);

  return { state, refresh, metricFor };
}
