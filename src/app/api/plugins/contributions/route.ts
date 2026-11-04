import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, handleCorsOptions } from "@/shared/utils/cors";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { buildPluginContributionsPayload } from "@/lib/plugins/dashboard";

export async function OPTIONS() {
  return handleCorsOptions();
}

/**
 * GET /api/plugins/contributions — what active plugins want the host to render.
 *
 * Read-only aggregate of every active plugin's declarative contributions. The
 * dashboard layout consumes the same builder server-side; this endpoint exists
 * for inspection and for anyone driving the UI out-of-process.
 *
 * ADDITIVE: `/api/plugins` keeps its existing response shape.
 */
export async function GET(request: NextRequest) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const payload = await buildPluginContributionsPayload();
    return NextResponse.json(payload, { headers: CORS_HEADERS });
  } catch (err: unknown) {
    console.error("[plugins] Failed to read contributions:", err);
    return NextResponse.json(buildErrorBody(500, "Failed to read plugin contributions"), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
