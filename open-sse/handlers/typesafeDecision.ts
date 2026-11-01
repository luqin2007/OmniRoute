/**
 * TypeSafe decision API proxy (`/v1/systemone`, `/v1/decisions`).
 *
 * These endpoints do not speak chat completions: the client posts a `state` plus typed
 * `questions` and TypeSafe answers with probabilities/scores. The body is therefore forwarded
 * verbatim — this handler only attaches the credential, logs the call, and keeps upstream error
 * text out of the response (Hard Rule #12).
 */

import { CORS_HEADERS } from "../utils/cors.ts";
import { errorResponse, sanitizeErrorMessage } from "../utils/error.ts";
import { attachOmniRouteMetaHeaders } from "@/domain/omnirouteResponseMeta";
import { generateRequestId } from "@/shared/utils/requestId";
import { saveCallLog } from "@/lib/usageDb";

export interface TypesafeDecisionCredentials {
  apiKey?: string | null;
  accessToken?: string | null;
  connectionId?: string | null;
}

export interface TypesafeDecisionProxyOptions {
  /** Client-facing path, used for the call log row (e.g. `/v1/systemone`). */
  path: string;
  /** Absolute upstream URL. */
  upstreamUrl: string;
  body: Record<string, unknown>;
  credentials: TypesafeDecisionCredentials | null;
  /** Model sent upstream, for the call log. */
  model?: string | null;
  provider?: string;
}

function upstreamErrorMessage(parsed: unknown, status: number): string {
  if (parsed && typeof parsed === "object") {
    const record = parsed as { message?: unknown; error?: unknown };
    if (typeof record.message === "string" && record.message.trim()) {
      return sanitizeErrorMessage(record.message);
    }
    // `error` is a string in some TypeSafe errors and an object in others.
    if (typeof record.error === "string" && record.error.trim()) {
      return sanitizeErrorMessage(record.error);
    }
    if (record.error && typeof record.error === "object") {
      const nested = (record.error as { message?: unknown }).message;
      if (typeof nested === "string" && nested.trim()) return sanitizeErrorMessage(nested);
    }
  }
  return `TypeSafe returned HTTP ${status}`;
}

/** Tokens are billed by TypeSafe, so usage counters stay at zero in OmniRoute's own stats. */
export async function handleTypesafeDecisionProxy(
  options: TypesafeDecisionProxyOptions
): Promise<Response> {
  const startTime = Date.now();
  const provider = options.provider || "typesafe";
  const token = options.credentials?.apiKey || options.credentials?.accessToken;
  const connectionId = options.credentials?.connectionId || null;

  if (!token) {
    return errorResponse(401, `No credentials for provider: ${provider}`);
  }

  try {
    const res = await fetch(options.upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(options.body),
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    saveCallLog({
      method: "POST",
      path: options.path,
      status: res.status,
      model: options.model || provider,
      provider,
      duration: Date.now() - startTime,
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      connectionId,
      ...(res.ok ? {} : { error: upstreamErrorMessage(parsed, res.status) }),
    }).catch(() => {});

    if (!res.ok) {
      return errorResponse(res.status, upstreamErrorMessage(parsed, res.status));
    }

    if (parsed === null) {
      return errorResponse(502, "TypeSafe returned a non-JSON body");
    }

    const headers = new Headers({ ...CORS_HEADERS, "Content-Type": "application/json" });
    attachOmniRouteMetaHeaders(headers, {
      provider,
      model: options.model || provider,
      costUsd: 0,
      latencyMs: Date.now() - startTime,
      requestId: generateRequestId(),
    });
    return new Response(JSON.stringify(parsed), { status: 200, headers });
  } catch (error) {
    return errorResponse(502, `TypeSafe request failed: ${sanitizeErrorMessage(error)}`);
  }
}
