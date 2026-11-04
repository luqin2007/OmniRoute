import type {
  SidebarItemDefinition,
  SidebarSectionDefinition,
  SidebarSectionId,
} from "@/shared/constants/sidebarVisibility";
import type { PluginNavContribution } from "./types";

/** Where a plugin entry lands when it names no (or an unknown) section. */
const DEFAULT_SECTION: SidebarSectionId = "other-features";

/**
 * Fold plugin-declared navigation entries into the static sidebar definition.
 *
 * The sidebar itself stays a compile-time constant: this only appends entries to
 * the sections that already exist, so ordering, hiding, pinning and visibility
 * rules keep working unchanged. Entries pointing at an unknown section fall back
 * to "Other Features" instead of silently disappearing.
 */
export function withPluginNav(
  sections: readonly SidebarSectionDefinition[],
  nav: readonly PluginNavContribution[]
): SidebarSectionDefinition[] {
  if (nav.length === 0) return sections as SidebarSectionDefinition[];

  const knownSections = new Set(sections.map((section) => section.id));
  const additions = new Map<SidebarSectionId, SidebarItemDefinition[]>();

  for (const entry of nav) {
    const sectionId =
      entry.sectionId && knownSections.has(entry.sectionId as SidebarSectionId)
        ? (entry.sectionId as SidebarSectionId)
        : DEFAULT_SECTION;
    if (!knownSections.has(sectionId)) continue;

    const item: SidebarItemDefinition = {
      // Plugin ids are not part of the literal union; they never collide with a
      // built-in id because contributions are namespaced by the plugin name.
      id: entry.id as SidebarItemDefinition["id"],
      href: entry.href,
      // Fall back to a namespaced key so translations stay overridable via the
      // plugin's own i18n overlay.
      i18nKey: entry.i18nKey ?? `plugin.${entry.id}.title`,
      labelFallback: entry.labelFallback,
      ...(entry.subtitleKey ? { subtitleKey: entry.subtitleKey } : {}),
      ...(entry.subtitleFallback ? { subtitleFallback: entry.subtitleFallback } : {}),
      icon: entry.icon ?? "extension",
    };

    const bucket = additions.get(sectionId);
    if (bucket) {
      if (!bucket.some((existing) => existing.id === item.id)) bucket.push(item);
    } else {
      additions.set(sectionId, [item]);
    }
  }

  if (additions.size === 0) return sections as SidebarSectionDefinition[];

  return sections.map((section) => {
    const extra = additions.get(section.id);
    if (!extra) return section;
    return { ...section, children: [...section.children, ...extra] };
  });
}
