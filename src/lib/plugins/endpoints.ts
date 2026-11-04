/**
 * Plugin endpoint dispatcher — lets an active plugin serve a real HTTP route.
 *
 * Next.js route tables are fixed at build time, so a plugin cannot add a route
 * directory at runtime. Instead the `/api/v1/[...]` catch-all (which previously
 * only produced a JSON 404) asks this dispatcher first: if an active plugin
 * declared the path, the request is forwarded to that plugin's child process and
 * its answer is returned; otherwise the caller falls through to the original
 * 404 body, byte-for-byte unchanged.
 *
 * Why not a per-plugin route: "install the plugin and the endpoint exists,
 * uninstall it and the endpoint is gone" is only achievable when the route table
 * is stable and the decision is made per request.
 *
 * @module plugins/endpoints
 */

import { CORS_HEADERS } from "@/shared/utils/cors";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { logger } from "../../../open-sse/utils/logger.ts";
import { pluginManager } from "./manager";
import { findContributedEndpoint } from "./contributions";
import { isEndpointPathAllowed, toManifestPath } from "./endpointPath";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

const log = logger("PLUGIN_ENDPOINTS");

/** Request bodies above this size are rejected instead of buffered. */
const MAX_BODY_CHARS = 1_000_000;

/** Inbound headers worth forwarding; everything else (cookies, host, …) is dropped. */
const FORWARDED_HEADERS = ["content-type", "authorization", "user-agent", "accept"];

export interface PluginEndpointReply {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

function jsonError(status: number, type: string, message: string, code: string): Response {
  return Response.json(buildErrorBody(status, message, undefined, { type, code }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) {
    throw new Error(`Request body exceeds ${MAX_BODY_CHARS} characters`);
  }
  if (raw.trim().length === 0) return undefined;
  return JSON.parse(raw);
}

/**
 * Try to serve `request` from a plugin endpoint.
 *
 * @returns a Response when a plugin owns the path, or null to let the caller
 *          produce its normal "unknown route" answer.
 */
export async function dispatchPluginEndpoint(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const manifestPath = toManifestPath(url.pathname);

  // Defence in depth: the manifest schema already constrains `path`, but a
  // tampered DB snapshot must not let a plugin answer /dashboard or /api/settings.
  if (!isEndpointPathAllowed(manifestPath)) return null;

  let match;
  try {
    match = await findContributedEndpoint(request.method, manifestPath);
  } catch (err: any) {
    log.warn("endpoints.match_failed", { path: manifestPath, error: err?.message });
    return null;
  }
  if (!match) return null;

  const { bundle, endpoint } = match;

  if (endpoint.auth === "management") {
    const authError = await requireManagementAuth(request);
    if (authError) return authError;
  }

  let body: unknown;
  if (request.method !== "GET" && request.method !== "DELETE") {
    try {
      body = await readJsonBody(request);
    } catch (err: any) {
      return jsonError(
        400,
        "invalid_request_error",
        `Invalid JSON body: ${err?.message}`,
        "invalid_json"
      );
    }
  }

  const headers: Record<string, string> = {};
  for (const key of FORWARDED_HEADERS) {
    const value = request.headers.get(key);
    if (value) headers[key] = value;
  }

  const payload = {
    method: request.method,
    path: manifestPath,
    query: Object.fromEntries(url.searchParams.entries()),
    headers,
    body,
  };

  let reply: unknown;
  try {
    reply = await pluginManager.invokeEndpoint(
      bundle.plugin,
      endpoint.handler,
      payload,
      endpoint.timeoutMs
    );
  } catch (err: any) {
    // A dead or timed-out plugin must never surface as a 500 with a stack trace.
    log.warn("endpoints.invoke_failed", {
      plugin: bundle.plugin,
      handler: endpoint.handler,
      path: manifestPath,
      error: err?.message,
    });
    return jsonError(
      502,
      "upstream_error",
      `Plugin '${bundle.plugin}' failed to handle this endpoint`,
      "plugin_endpoint_failed"
    );
  }

  const parsed = (reply ?? {}) as PluginEndpointReply;
  const status = typeof parsed.status === "number" ? parsed.status : 200;

  // 204/304 must not carry a body.
  if (status === 204 || status === 304) {
    return new Response(null, { status, headers: { ...CORS_HEADERS } });
  }

  return Response.json(parsed.body ?? null, {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-OmniRoute-Plugin": bundle.plugin,
      ...CORS_HEADERS,
      ...(parsed.headers ?? {}),
    },
  });
}
