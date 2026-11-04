import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, handleCorsOptions } from "@/shared/utils/cors";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { listPluginNotices } from "@/lib/db/pluginNotices";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

export async function OPTIONS() {
  return handleCorsOptions();
}

/**
 * GET /api/plugins/notices — Operator notices about installed plugins.
 *
 * Dismissed notices are hidden by default; `?includeDismissed=1` exposes them for
 * diagnostics. Nothing here is time-based: a notice disappears only when the
 * operator dismisses it or when its cause is gone (binary installed / plugin
 * deactivated).
 */
export async function GET(request: NextRequest) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const includeDismissed = new URL(request.url).searchParams.get("includeDismissed") === "1";
    const notices = listPluginNotices({ includeDismissed });
    return NextResponse.json({ notices }, { headers: CORS_HEADERS });
  } catch (err: unknown) {
    console.error("[plugins] Failed to list notices:", err);
    return NextResponse.json(buildErrorBody(500, "Failed to list plugin notices"), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
