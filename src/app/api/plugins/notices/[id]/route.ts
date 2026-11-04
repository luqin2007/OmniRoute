import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, handleCorsOptions } from "@/shared/utils/cors";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { dismissPluginNotice } from "@/lib/db/pluginNotices";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

export async function OPTIONS() {
  return handleCorsOptions();
}

/**
 * DELETE /api/plugins/notices/[id] — Dismiss one notice.
 *
 * The only way a notice stops being shown while its plugin is still active. There
 * is deliberately no expiry, no "snooze" and no automatic re-raise after a restart.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  const { id } = await params;
  try {
    if (!dismissPluginNotice(id)) {
      return NextResponse.json(buildErrorBody(404, `Notice '${id}' not found`), {
        status: 404,
        headers: CORS_HEADERS,
      });
    }
    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (err: unknown) {
    console.error("[plugins] Failed to dismiss notice:", err);
    return NextResponse.json(buildErrorBody(500, "Failed to dismiss plugin notice"), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
