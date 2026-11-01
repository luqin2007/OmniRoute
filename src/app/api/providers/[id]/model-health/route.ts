import { NextResponse } from "next/server";
import pino from "pino";
import { z } from "zod";

import { buildErrorBody, sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";
import { getRegistryEntry } from "@omniroute/open-sse/config/providerRegistry.ts";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getProviderConnections } from "@/lib/db/providers";
import { getProviderNodeById } from "@/lib/db/providers/nodes";
import {
  buildPerfMetricsUrl,
  clampPerfMetricsHours,
  normalizePerfMetricsPayload,
  perfMetricsOrigin,
  type ModelHealthResponse,
  type ModelHealthSource,
} from "@/lib/providers/perfMetrics";
import { SAFE_OUTBOUND_FETCH_PRESETS, safeOutboundFetch } from "@/shared/network/safeOutboundFetch";
import { getProviderOutboundGuard } from "@/shared/network/outboundUrlGuardPolicy";

const logger = pino({ name: "provider-model-health-api" });

/**
 * GET /api/providers/{id}/model-health?hours=24
 *
 * Reads the model health that the provider's OWN gateway reports at
 * `/api/perf-metrics/summary` (NewAPI-style deployments). OmniRoute measured nothing here:
 * latency / throughput / success rate are the gateway's numbers, kept separate from the
 * `call_logs` statistics served by `/api/provider-metrics`.
 *
 * Up to three origins are probed per request — the provider node's base URL, any
 * connection-level `baseUrl` override, and the static registry base URL — and every origin
 * is reported individually, so a node whose connections point at two different gateways shows
 * both instead of silently picking one.
 */

export const dynamic = "force-dynamic";

const PER_REQUEST_TIMEOUT_MS = 8_000;
/** The gateway summary is hourly; a minute of cache keeps repeated clicks off the upstream. */
const CACHE_TTL_MS = 60_000;
const MAX_ORIGINS = 3;

const paramsSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict();

const querySchema = z.object({
  hours: z.string().trim().max(10).optional().nullable(),
});

type RouteContext = { params: Promise<{ id: string }> };

interface CacheEntry {
  expiresAt: number;
  payload: ModelHealthResponse;
}

const cache = new Map<string, CacheEntry>();

function readField(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null) return row[name];
  }
  return null;
}

/** `provider_specific_data.baseUrl` is the per-connection gateway override. */
function connectionBaseUrl(row: Record<string, unknown>): string | null {
  const raw = readField(row, "providerSpecificData", "provider_specific_data");
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const baseUrl = (data as Record<string, unknown>).baseUrl;
  return typeof baseUrl === "string" && baseUrl.trim() ? baseUrl : null;
}

/**
 * Collect candidate gateway origins for a provider, most specific first.
 *
 * `getProviderNodeById` covers custom OpenAI-compatible nodes (`openai-compatible-*`), whose
 * base URL lives in the database; the registry covers built-in providers.
 */
async function resolveOrigins(providerId: string): Promise<string[]> {
  const origins: string[] = [];
  const push = (value: string | null | undefined) => {
    const origin = perfMetricsOrigin(value ?? null);
    if (origin && !origins.includes(origin) && origins.length < MAX_ORIGINS) origins.push(origin);
  };

  try {
    const node = (await getProviderNodeById(providerId)) as Record<string, unknown> | null;
    if (node) push(String(readField(node, "baseUrl", "base_url") ?? "") || null);
  } catch (error) {
    logger.debug({ providerId, err: sanitizeErrorMessage(error) }, "node lookup failed");
  }

  if (origins.length < MAX_ORIGINS) {
    try {
      const connections = (await getProviderConnections({ provider: providerId }, MAX_ORIGINS, 0, [
        "id",
        "provider",
        "provider_specific_data",
      ])) as Array<Record<string, unknown>>;
      for (const connection of connections) push(connectionBaseUrl(connection));
    } catch (error) {
      logger.debug({ providerId, err: sanitizeErrorMessage(error) }, "connection lookup failed");
    }
  }

  if (origins.length === 0) {
    const entry = getRegistryEntry(providerId) as
      { baseUrl?: string | null; baseUrls?: string[] | null } | null | undefined;
    if (entry?.baseUrl) push(entry.baseUrl);
    if (entry?.baseUrls) for (const url of entry.baseUrls) push(url);
  }

  return origins;
}

async function probeOrigin(origin: string, hours: number): Promise<ModelHealthSource> {
  const url = buildPerfMetricsUrl(origin, hours);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);

  try {
    const response = await safeOutboundFetch(url, {
      ...SAFE_OUTBOUND_FETCH_PRESETS.validationRead,
      guard: getProviderOutboundGuard(),
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      // Status only: a gateway error body can echo upstream model data.
      return { origin, ok: false, error: `HTTP ${response.status}`, report: null };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { origin, ok: false, error: "response was not JSON", report: null };
    }

    const report = normalizePerfMetricsPayload(body);
    if (!report) {
      return { origin, ok: false, error: "no model health in payload", report: null };
    }
    return { origin, ok: true, error: null, report };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      origin,
      ok: false,
      error: aborted
        ? `timed out after ${PER_REQUEST_TIMEOUT_MS}ms`
        : sanitizeErrorMessage(error) || "request failed",
      report: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  let providerId = "";
  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json(buildErrorBody(400, "Invalid provider id"), { status: 400 });
    }
    providerId = parsedParams.data.id;

    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({ hours: url.searchParams.get("hours") });
    if (!parsedQuery.success) {
      return NextResponse.json(buildErrorBody(400, "Invalid hours parameter"), { status: 400 });
    }
    const hours = clampPerfMetricsHours(parsedQuery.data.hours);

    const cacheKey = `${providerId}:${hours}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ ...cached.payload, cached: true });
    }

    const origins = await resolveOrigins(providerId);
    if (origins.length === 0) {
      const payload: ModelHealthResponse = {
        providerId,
        hours,
        fetchedAt: new Date().toISOString(),
        cached: false,
        sources: [],
        error: "provider has no gateway base URL",
      };
      return NextResponse.json(payload);
    }

    const sources = await Promise.all(origins.map((origin) => probeOrigin(origin, hours)));
    const payload: ModelHealthResponse = {
      providerId,
      hours,
      fetchedAt: new Date().toISOString(),
      cached: false,
      sources,
      error: sources.some((source) => source.ok) ? null : "every gateway origin failed",
    };

    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    return NextResponse.json(payload);
  } catch (error) {
    logger.error({ providerId, err: sanitizeErrorMessage(error) }, "model health request failed");
    return NextResponse.json(buildErrorBody(500, "Failed to read provider model health"), {
      status: 500,
    });
  }
}
