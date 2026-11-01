/**
 * Shared plumbing for the TypeSafe decision endpoints:
 *
 *   POST /v1/systemone   — models jev / clef
 *   POST /v1/decisions   — model  gpt
 *
 * Both routes are the same request pipeline (client auth → key policy → connection scope →
 * `typesafe` credentials → verbatim proxy), so the pipeline lives here once and each route
 * file only names its endpoint. Kept out of the route files so the two never drift.
 */

import {
  getProviderCredentialsWithQuotaPreflight,
  clearRecoveredProviderState,
} from "@/sse/services/auth";
import { errorResponse } from "@omniroute/open-sse/utils/error.ts";
import { HTTP_STATUS } from "@omniroute/open-sse/config/constants.ts";
import { TYPESAFE_PROVIDER_ID, TYPESAFE_SYSTEM_ONE_BASE_URL } from "@omniroute/open-sse/services/typesafe/systemOne.ts";
import {
  buildDecisionRequestBody,
  resolveDecisionModel,
  typesafeEndpointPath,
  type TypesafeEndpoint,
} from "@omniroute/open-sse/services/typesafe/decisions.ts";
import { handleTypesafeDecisionProxy } from "@omniroute/open-sse/handlers/typesafeDecision.ts";
import { enforceApiKeyPolicy } from "@/shared/utils/apiKeyPolicy";
import {
  isKeyScopeBlockedCredentials,
  keyScopeBlockedResponse,
  resolveKeyConnectionScope,
} from "@/sse/services/keyConnectionScope";
import {
  isAllRateLimitedCredentials,
  rateLimitedProviderResponse,
} from "@/app/api/v1/_shared/rateLimit";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function handleDecisionRequest(
  endpoint: TypesafeEndpoint,
  request: Request
): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  if (!isJsonObject(rawBody)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Request body must be a JSON object");
  }

  const resolved = resolveDecisionModel(endpoint, rawBody.model);
  if (!resolved.ok) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, resolved.error);
  }

  const policy = await enforceApiKeyPolicy(request, resolved.model);
  if (policy.rejection) return policy.rejection;

  // Credential selection stays inside the key's connection scope (GHSA-3w2r), like chat.
  const scope = await resolveKeyConnectionScope(policy.apiKeyInfo);
  if (scope.rejection) return scope.rejection;

  const credentials = await getProviderCredentialsWithQuotaPreflight(
    TYPESAFE_PROVIDER_ID,
    null,
    scope.allowedConnections
  );
  if (!credentials) {
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `No credentials for provider: ${TYPESAFE_PROVIDER_ID}`
    );
  }
  if (isKeyScopeBlockedCredentials(credentials)) {
    return keyScopeBlockedResponse(TYPESAFE_PROVIDER_ID, credentials);
  }
  if (isAllRateLimitedCredentials(credentials)) {
    return rateLimitedProviderResponse(TYPESAFE_PROVIDER_ID, credentials);
  }

  const path = typesafeEndpointPath(endpoint);
  const response = await handleTypesafeDecisionProxy({
    path,
    upstreamUrl: `${TYPESAFE_SYSTEM_ONE_BASE_URL}${path}`,
    body: buildDecisionRequestBody(rawBody, resolved.model),
    credentials,
    model: resolved.model,
    provider: TYPESAFE_PROVIDER_ID,
  });
  if (response.ok) {
    await clearRecoveredProviderState(credentials);
  }
  return response;
}

/** `POST` handler for one decision endpoint. */
export function makeTypesafeDecisionPost(endpoint: TypesafeEndpoint) {
  return function post(request: Request): Promise<Response> {
    return handleDecisionRequest(endpoint, request);
  };
}

/** CORS preflight, matching the other `/v1` endpoints. */
export function typesafeDecisionOptions(): Response {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
