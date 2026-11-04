import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import routeNamespaces from "@/i18n/routeNamespaces.generated.json";
import { normalizeComplianceEventTypes } from "@/i18n/request";
import { pickMessages } from "@/i18n/pickMessages";
import { DashboardLayout } from "@/shared/components";
import { PluginContributionsProvider } from "@/shared/components/plugins/PluginContributionsProvider";
import { PluginNoticeBanner } from "@/shared/components/plugins/PluginNoticeBanner";
import { buildPluginCss, buildPluginContributionsPayload } from "@/lib/plugins/dashboard";
import { listPluginNotices, type PluginNoticeRow } from "@/lib/db/pluginNotices";

/**
 * Open plugin notices, or none.
 *
 * Deliberately fail-open: a missing notice table (older DB, migration not run yet)
 * must not turn every dashboard page into a 500 — the notice is a courtesy, the
 * dashboard is the product.
 */
function readPluginNotices(): PluginNoticeRow[] {
  try {
    return listPluginNotices();
  } catch {
    return [];
  }
}

/**
 * Dashboard chrome i18n provider — serves only the namespaces the shared
 * shell (Header, Sidebar, CommandPalette, …) uses. Each dashboard section
 * re-scopes the catalog again with its own SectionI18nProvider layout
 * (generated — see scripts/i18n/generate-route-namespaces.mjs).
 *
 * Plugin contributions are collected here, once per request (5s server cache),
 * and handed to the client tree through context. With no active plugin the
 * payload is empty: no <style> tag, no nav entries, no slots.
 */
export default async function DashboardRootLayout({ children }: { children: React.ReactNode }) {
  const messages = normalizeComplianceEventTypes(
    pickMessages((await getMessages()) as Record<string, unknown>, routeNamespaces.chrome)
  );

  const contributions = await buildPluginContributionsPayload();
  const pluginCss = buildPluginCss(contributions.css);
  const notices = readPluginNotices();

  return (
    <NextIntlClientProvider messages={messages}>
      <PluginContributionsProvider value={contributions}>
        {pluginCss ? (
          // Hide rules are selector-only by contract (no declarations from the
          // plugin), so this can never inject script or override host styles.
          <style id="omni-plugin-css" dangerouslySetInnerHTML={{ __html: pluginCss }} />
        ) : null}
        <DashboardLayout>
          <PluginNoticeBanner
            notices={notices.map((notice) => ({
              id: notice.id,
              pluginName: notice.pluginName,
              code: notice.code,
              subject: notice.subject,
              message: notice.message,
            }))}
          />
          {children}
        </DashboardLayout>
      </PluginContributionsProvider>
    </NextIntlClientProvider>
  );
}
