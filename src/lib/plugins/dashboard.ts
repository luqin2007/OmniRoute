/**
 * Server-side assembly of the dashboard payload for plugin contributions.
 *
 * Kept separate from the route handler so the `(dashboard)` server layout and the
 * inspection endpoint return the exact same shape — one definition, no drift.
 *
 * @module plugins/dashboard
 */

import { getPluginContributions } from "./contributions";
import type {
  PluginContributionsPayload,
  PluginNavContribution,
  PluginPageRef,
  PluginProviderGroup,
  PluginSlotContribution,
  PluginTabContribution,
  PluginWidgetSpec,
} from "@/shared/components/plugins/types";

/** Compose the hide rules a plugin declared into one stylesheet. */
export function buildPluginCss(selectors: readonly string[]): string {
  const unique = Array.from(new Set(selectors.map((value) => value.trim()).filter(Boolean)));
  if (unique.length === 0) return "";
  return `${unique.join(",\n")}{display:none!important}`;
}

export async function buildPluginContributionsPayload(): Promise<PluginContributionsPayload> {
  const bundles = await getPluginContributions();

  const nav: PluginNavContribution[] = bundles.flatMap((bundle) =>
    (bundle.contributes.nav ?? []).map((entry) => ({ ...entry, plugin: bundle.plugin }))
  );

  const providerGroups: PluginProviderGroup[] = bundles.flatMap((bundle) =>
    (bundle.contributes.providerGroups ?? []).map((entry) => ({ ...entry, plugin: bundle.plugin }))
  );

  const pages: PluginPageRef[] = bundles.flatMap((bundle) =>
    (bundle.contributes.pages ?? []).map((entry) => ({
      id: entry.id,
      plugin: bundle.plugin,
      path: `/dashboard/plugin/${bundle.plugin}/${entry.id}`,
      titleKey: entry.titleKey,
      titleFallback: entry.titleFallback,
      descriptionFallback: entry.descriptionFallback,
    }))
  );

  const slots: PluginSlotContribution[] = bundles.flatMap((bundle) =>
    (bundle.contributes.slots ?? []).map((entry) => ({
      name: entry.name,
      plugin: bundle.plugin,
      // The manifest was Zod-validated, so these already match the closed union.
      widgets: entry.widgets as unknown as PluginWidgetSpec[],
    }))
  );

  const tabs: PluginTabContribution[] = bundles.flatMap((bundle) =>
    (bundle.contributes.tabs ?? []).map((entry) => ({
      screen: entry.screen,
      id: entry.id,
      plugin: bundle.plugin,
      labelFallback: entry.labelFallback,
      icon: entry.icon,
      // Manifest validated against the closed widget union above.
      widgets: entry.widgets as unknown as PluginWidgetSpec[],
    }))
  );

  const css = bundles.flatMap((bundle) => bundle.contributes.css?.hiddenSelectors ?? []);

  return {
    nav,
    providerGroups,
    pages,
    slots,
    tabs,
    css,
    ui: {
      passwordReveal: bundles.some((bundle) => bundle.contributes.ui?.passwordReveal === true),
    },
    plugins: bundles.map((bundle) => ({ name: bundle.plugin })),
  };
}

/** Full widget set of one page contribution, or null when it is not served. */
export async function getPluginPage(
  plugin: string,
  pageId: string
): Promise<{
  plugin: string;
  pageId: string;
  titleFallback: string;
  descriptionFallback?: string;
  widgets: PluginWidgetSpec[];
} | null> {
  const bundles = await getPluginContributions();
  const bundle = bundles.find((entry) => entry.plugin === plugin);
  const page = bundle?.contributes.pages?.find((entry) => entry.id === pageId);
  if (!bundle || !page) return null;

  return {
    plugin: bundle.plugin,
    pageId: page.id,
    titleFallback: page.titleFallback,
    descriptionFallback: page.descriptionFallback,
    widgets: page.widgets as unknown as PluginWidgetSpec[],
  };
}
