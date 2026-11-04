import { CORS_HEADERS } from "@/shared/utils/cors";
import { dispatchPluginEndpoint } from "@/lib/plugins/endpoints";

/**
 * Catch-all fallback for /v1/* (and /api/v1/*) — issue #6405.
 *
 * Without this route, unknown /v1/* paths fell through to the Next.js app-router
 * `not-found.tsx`, which returned the dashboard HTML 404 to API clients. OpenAI-
 * compatible clients (and their SDKs) expect JSON with `error.type === "not_found"`
 * so they can surface the failure instead of crashing on an HTML parse.
 *
 * Static / dynamic segments under /api/v1/ take precedence over this catch-all in
 * Next.js App Router matching, so real routes like `/v1/models` and
 * `/v1/chat/completions` are unaffected.
 */

function notFoundResponse(request: Request): Response {
  const url = new URL(request.url);
  return Response.json(
    {
      error: {
        message: `Unknown API route: ${url.pathname}`,
        type: "not_found",
        code: "unknown_route",
        path: url.pathname,
      },
    },
    {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    }
  );
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * Ask the plugin dispatcher first, then fall back to the historical 404.
 *
 * A plugin can only answer paths it declared in `contributes.endpoints`, and only
 * while it is active — an uninstalled or deactivated plugin leaves this route
 * behaving exactly like the release it replaced.
 */
async function dispatchOrNotFound(request: Request): Promise<Response> {
  try {
    const pluginResponse = await dispatchPluginEndpoint(request);
    if (pluginResponse) return pluginResponse;
  } catch {
    // Dispatcher is fail-open by design: never turn a plugin problem into a 500
    // on a route that is documented to answer 404 for unknown paths.
  }
  return notFoundResponse(request);
}

export async function GET(request: Request) {
  return dispatchOrNotFound(request);
}
export async function POST(request: Request) {
  return dispatchOrNotFound(request);
}
export async function PUT(request: Request) {
  return dispatchOrNotFound(request);
}
export async function PATCH(request: Request) {
  return dispatchOrNotFound(request);
}
export async function DELETE(request: Request) {
  return dispatchOrNotFound(request);
}
export async function HEAD(request: Request) {
  return dispatchOrNotFound(request);
}
