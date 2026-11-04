import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, handleCorsOptions } from "@/shared/utils/cors";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { pluginManager } from "@/lib/plugins/manager";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

export async function OPTIONS() {
  return handleCorsOptions();
}

/**
 * POST /api/plugins/[name]/providers/sync — re-apply declared provider nodes.
 *
 * Needed after the operator edits a catalogue file (e.g. a 78-entry list that
 * lives next to the plugin) — activation already ran, so nothing would re-read
 * it. Idempotent: nodes that already exist are re-claimed, not duplicated.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;
  const { name } = await params;

  try {
    const result = await pluginManager.syncProviderNodes(name);
    return NextResponse.json({ success: true, ...result }, { headers: CORS_HEADERS });
  } catch (err: unknown) {
    console.error("[plugins] Failed to sync provider nodes:", err);
    const message = err instanceof Error ? err.message : "Failed to sync provider nodes";
    return NextResponse.json(buildErrorBody(400, message), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
}
