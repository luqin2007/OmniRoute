"use client";

// Phase 1t.1 extraction — Issue #3501
import Link from "next/link";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getHeaderIconProviderId, providerText } from "../providerPageHelpers";
import type { ProviderMessageTranslator } from "../providerPageHelpers";
import type { ProviderNotice } from "@/lib/providers/catalog";

interface ProviderInfo {
  id: string;
  name: string;
  website?: string;
  color?: string;
  apiType?: string;
  /** Optional operator-supplied remote icon URL (#2166) for compatible provider nodes. */
  iconUrl?: string;
  /** Short text-badge fallback (e.g. "OC"/"AC"/"CC") shown if `iconUrl` fails to load. */
  textIcon?: string;
  /** Optional registration/API-key URL hints rendered as links (#9270). */
  notice?: ProviderNotice;
}

interface ProviderPageHeaderProps {
  providerId: string;
  providerInfo: ProviderInfo;
  connectionsCount: number;
  isOpenAICompatible: boolean;
  isAnthropicProtocolCompatible: boolean;
  onOpenTutorial: () => void;
  t: ProviderMessageTranslator;
  /**
   * True when `providerInfo.website` was overridden with a Radar default
   * referral link (D28 — referral links / free credits), rather than the
   * static catalog `website`. Drives the discreet "Partner link" disclosure,
   * so a monetized link never reads as a plain "visit provider website".
   */
  isReferralLink?: boolean;
}

export default function ProviderPageHeader({
  providerId,
  providerInfo,
  connectionsCount,
  isOpenAICompatible,
  isAnthropicProtocolCompatible,
  onOpenTutorial,
  t,
  isReferralLink = false,
}: ProviderPageHeaderProps) {
  // D28: a Radar-driven default referral is a monetized link, so it gets a
  // discreet "Partner link" disclosure rather than reading as a plain "visit
  // provider website". Catalog `website` values carry no affiliate/tracking
  // parameters (the Kimi partnership tagging was removed from the fork), so
  // they render as ordinary links with no note.
  const showPartnerNote = isReferralLink;
  // i18n key keeps its historical name (`kimiPartnerLinkNote`) — the copy is
  // generic and it is now only reachable through the referral path.
  const partnerLinkNote = providerText(
    t,
    "kimiPartnerLinkNote",
    "Partner link — supports OmniRoute at no extra cost to you"
  );

  // Resolve the API-key registration link: prefer apiKeyUrl, fall back to
  // signupUrl, hide when neither is set (#9270).
  const noticeUrl = providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl;
  const apiKeyLink = noticeUrl ? (
    <a
      href={noticeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm font-medium underline underline-offset-2 opacity-70 hover:opacity-100 transition-opacity inline-flex items-center gap-1"
      style={{ color: providerInfo.color }}
    >
      <span className="material-symbols-outlined text-base">open_in_new</span>
      {t("getApiKey")}
    </a>
  ) : null;

  return (
    <div>
      <Link
        href="/dashboard/providers"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        {t("backToProviders")}
      </Link>
      <div className="flex items-center gap-4">
        <div
          className="rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${providerInfo.color}15` }}
        >
          <ProviderIcon
            providerId={getHeaderIconProviderId(
              isOpenAICompatible,
              isAnthropicProtocolCompatible,
              providerInfo.id,
              providerInfo.apiType
            )}
            size={48}
            type="color"
            src={providerInfo.iconUrl}
            alt={providerInfo.name}
            fallbackText={providerInfo.textIcon}
            fallbackColor={providerInfo.color}
          />
        </div>
        <div>
          {providerInfo.website ? (
            <a
              href={providerInfo.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-3xl font-semibold tracking-tight hover:underline inline-flex items-center gap-2"
              style={{ color: providerInfo.color }}
              title={showPartnerNote ? partnerLinkNote : undefined}
              aria-label={showPartnerNote ? `${providerInfo.name} — ${partnerLinkNote}` : undefined}
            >
              {providerInfo.name}
              <span className="material-symbols-outlined text-lg opacity-60">open_in_new</span>
            </a>
          ) : (
            <h1 className="text-3xl font-semibold tracking-tight">{providerInfo.name}</h1>
          )}
          <div className="flex items-center gap-2">
            <p className="text-text-muted">
              {t("connectionCountLabel", { count: connectionsCount })}
            </p>
            {showPartnerNote && providerInfo.website && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted/70">
                {partnerLinkNote}
              </span>
            )}
            {apiKeyLink}
            {providerId === "adapta-web" && (
              <button
                onClick={onOpenTutorial}
                className="text-sm font-medium underline underline-offset-2 opacity-70 hover:opacity-100 transition-opacity"
                style={{ color: providerInfo.color }}
              >
                Tutorial
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
