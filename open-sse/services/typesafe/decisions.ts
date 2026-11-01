/**
 * TypeSafe decision endpoints — `/v1/systemone` and `/v1/decisions`.
 *
 * TypeSafe answers typed questions about a `state` instead of producing chat completions.
 * OmniRoute exposes both endpoints so clients can reach them through the same gateway (and
 * the same `typesafe` credentials) as everything else:
 *
 *   - `POST /v1/systemone`  — System One; models `jev` and `clef`
 *   - `POST /v1/decisions`  — Decisions; model `gpt`
 *
 * Request/response bodies are forwarded as-is: the question schema (`noul` / `choice` /
 * `score` / `box`, `assets`, …) belongs to TypeSafe and is documented at
 * https://docs.typesafe.ai/api. Only the model field is validated here, against a per-endpoint
 * allowlist, so a typo fails fast with the accepted list instead of a billed upstream 400.
 */

import { TYPESAFE_SYSTEM_ONE_PATH } from "./systemOne.ts";

export const TYPESAFE_SYSTEMONE_PATH = TYPESAFE_SYSTEM_ONE_PATH;
export const TYPESAFE_DECISIONS_PATH = "/v1/decisions";

/** Models the System One endpoint accepts. `jev`/`clef` resolve to their `-latest` alias. */
export const TYPESAFE_SYSTEMONE_MODELS = ["jev", "jev-latest", "clef", "clef-latest"] as const;
export const TYPESAFE_SYSTEMONE_DEFAULT_MODEL = "jev-latest";

/** Models the Decisions endpoint accepts. */
export const TYPESAFE_DECISIONS_MODELS = ["gpt", "gpt-latest"] as const;
export const TYPESAFE_DECISIONS_DEFAULT_MODEL = "gpt-latest";

export type TypesafeEndpoint = "systemone" | "decisions";

export interface ResolvedDecisionModel {
  ok: true;
  /** Model name to send upstream (alias-expanded). */
  model: string;
}

export interface RejectedDecisionModel {
  ok: false;
  /** Why the request was rejected, safe to return to the caller verbatim. */
  error: string;
  allowed: readonly string[];
}

const ENDPOINT_CONFIG: Record<
  TypesafeEndpoint,
  { path: string; models: readonly string[]; defaultModel: string }
> = {
  systemone: {
    path: TYPESAFE_SYSTEMONE_PATH,
    models: TYPESAFE_SYSTEMONE_MODELS,
    defaultModel: TYPESAFE_SYSTEMONE_DEFAULT_MODEL,
  },
  decisions: {
    path: TYPESAFE_DECISIONS_PATH,
    models: TYPESAFE_DECISIONS_MODELS,
    defaultModel: TYPESAFE_DECISIONS_DEFAULT_MODEL,
  },
};

export function typesafeEndpointPath(endpoint: TypesafeEndpoint): string {
  return ENDPOINT_CONFIG[endpoint].path;
}

export function typesafeEndpointModels(endpoint: TypesafeEndpoint): readonly string[] {
  return ENDPOINT_CONFIG[endpoint].models;
}

export function typesafeEndpointDefaultModel(endpoint: TypesafeEndpoint): string {
  return ENDPOINT_CONFIG[endpoint].defaultModel;
}

/**
 * Resolve the `model` a caller asked for into the name sent upstream.
 *
 * An absent/blank model falls back to the endpoint default; an accepted name is forwarded
 * verbatim (TypeSafe treats `jev` and `jev-latest` as separate aliases, so rewriting one into
 * the other would silently change what the caller asked for). Anything else is rejected with
 * the accepted list — a wrong model is a client bug, and forwarding it would bill a request
 * that cannot succeed.
 */
export function resolveDecisionModel(
  endpoint: TypesafeEndpoint,
  requested: unknown
): ResolvedDecisionModel | RejectedDecisionModel {
  const { models, defaultModel } = ENDPOINT_CONFIG[endpoint];

  if (requested === undefined || requested === null) return { ok: true, model: defaultModel };

  if (typeof requested !== "string") {
    return {
      ok: false,
      error: `model must be a string. Allowed: ${models.join(", ")}.`,
      allowed: models,
    };
  }

  const raw = requested.trim().toLowerCase();
  if (!raw) return { ok: true, model: defaultModel };
  if (models.includes(raw)) return { ok: true, model: raw };

  return {
    ok: false,
    error: `Unsupported model for /v1/${endpoint}: ${raw}. Allowed: ${models.join(", ")}.`,
    allowed: models,
  };
}

/**
 * Body sent upstream: the caller's body with `model` normalised.
 *
 * Everything else is preserved byte-for-byte so a future question type cannot be broken by a
 * stale allowlist here.
 */
export function buildDecisionRequestBody(
  body: Record<string, unknown>,
  model: string
): Record<string, unknown> {
  return { ...body, model };
}
