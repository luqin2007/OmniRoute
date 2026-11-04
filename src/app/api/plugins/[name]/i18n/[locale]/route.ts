import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, handleCorsOptions } from "@/shared/utils/cors";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getPluginMessages } from "@/lib/plugins/i18n";

export async function OPTIONS() {
  return handleCorsOptions();
}

/**
 * GET /api/plugins/[name]/i18n/[locale] — one plugin's overlay for one locale.
 *
 * Inspection endpoint: the render path merges overlays server-side in
 * `src/i18n/request.ts` without an HTTP hop. Returns 404 when the plugin is
 * inactive, publishes no i18n, or has no file for that locale — which is the
 * normal case for most locales, not an error worth logging.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; locale: string }> }
) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;
  const { name, locale } = await params;

  try {
    const messages = await getPluginMessages(name, locale);
    if (!messages) {
      return NextResponse.json(
        buildErrorBody(404, `No '${locale}' messages for plugin '${name}'`),
        { status: 404, headers: CORS_HEADERS }
      );
    }
    return NextResponse.json({ plugin: name, locale, messages }, { headers: CORS_HEADERS });
  } catch (err: unknown) {
    console.error("[plugins] Failed to read plugin i18n:", err);
    return NextResponse.json(buildErrorBody(500, "Failed to read plugin messages"), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
