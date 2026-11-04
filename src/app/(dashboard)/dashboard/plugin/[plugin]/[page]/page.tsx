import { notFound } from "next/navigation";

import { getPluginPage } from "@/lib/plugins/dashboard";
import PluginPageClient from "./PluginPageClient";

/**
 * Generic renderer for plugin-declared pages.
 *
 * The URL is stable (`/dashboard/plugin/<plugin>/<page>`) and the content comes
 * from the plugin's manifest `contributes.pages`. When the plugin is deactivated
 * the contribution disappears and this route 404s — no orphan page survives.
 */
export default async function PluginContributedPage({
  params,
}: {
  params: Promise<{ plugin: string; page: string }>;
}) {
  const { plugin, page } = await params;
  const data = await getPluginPage(plugin, page);
  if (!data) notFound();

  return <PluginPageClient data={data} />;
}
