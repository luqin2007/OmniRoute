/**
 * Opt-in carve-out for the plugin-admin surface (Hard Rules #15 + #17).
 *
 * `/api/plugins` and `/api/plugins/**` are Tier-1 `LOCAL_ONLY` AND
 * `SPAWN_CAPABLE`, which makes them permanently ineligible for the
 * manage-scope bypass list (`isSpawnCapableBypassPrefix()` rejects every
 * overlap, in both directions). That is the correct default: a leaked
 * credential over a public tunnel must never reach plugin code execution.
 *
 * Some deployments are not tunnels, though: the dashboard is served from an
 * operator-controlled origin — a router-resolved LAN hostname, a private
 * reverse proxy — where the operator has deliberately decided that the plugin
 * admin surface may be driven remotely. `OMNIROUTE_REMOTE_PLUGIN_ADMIN_HOSTS`
 * is that decision, made explicitly, in configuration, and off by default.
 *
 * The gate is two-factor BY CONSTRUCTION:
 *   1. `resolveRemotePluginAdminScope()` must report a match — the request's
 *      `Host` header (ports stripped) against the hostname entries, or the
 *      trusted client IP against the address entries. The client IP comes from
 *      the token-stamped `x-omniroute-client-ip` header the custom Node server
 *      writes (proxy-resolved only when the proxy itself is trusted), so it
 *      cannot be forged by a direct caller.
 *   2. `policies/management.ts` must additionally authenticate a real
 *      principal: an authenticated dashboard session, or an API key carrying
 *      the `manage`/`admin` scope. Anonymous remote callers still get
 *      `403 LOCAL_ONLY`.
 *
 * SECURITY NOTES (read before widening this):
 *   - The `Host` header is client-controlled. A hostname entry is therefore
 *     NOT an access boundary on its own; the authenticated principal in step 2
 *     is. Host matching exists so an operator can scope the switch to the
 *     origin they actually use, and so a misconfigured deploy fails closed
 *     rather than open.
 *   - Address entries are matched against the same trusted client IP the IP
 *     allow/deny filter judges, never against `x-forwarded-for` directly.
 *   - Unset / empty → feature disabled, byte-identical to the previous
 *     behaviour (strict loopback).
 *   - This does NOT add `/api/plugins` to `LOCAL_ONLY_MANAGE_SCOPE_BYPASS_PREFIXES`
 *     and does not touch `SPAWN_CAPABLE_PREFIXES`; the compile-time deny-list
 *     stays intact for every other LOCAL_ONLY surface.
 *
 * Expected value forms (comma-separated, case-insensitive):
 *   ai.luqion.cn        exact host (a bare domain also covers its subdomains)
 *   *.luqion.cn         same suffix rule, spelled explicitly
 *   192.168.1.7         exact client IP
 *   192.168.1.*         IPv4 wildcard (whole octets only)
 *   192.168.1.0/24      IPv4 CIDR
 *   *  |  true  |  1    any host (still requires the authenticated principal)
 */

import { CLIENT_IP_HEADER, PEER_IP_HEADER } from "./headers";
import { resolveStampedPeer } from "./peerStamp";
import type { RequestLike } from "./context";

export const REMOTE_PLUGIN_ADMIN_HOSTS_ENV = "OMNIROUTE_REMOTE_PLUGIN_ADMIN_HOSTS";

const ANY_HOST_TOKENS = new Set(["*", "any", "true", "1", "yes", "on"]);

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV4_WILDCARD = /^\d{1,3}(?:\.\d{1,3}){0,2}\.\*$/;
const IPV4_CIDR = /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/;

export interface RemotePluginAdminAllowList {
  /** Any entry present at all. */
  enabled: boolean;
  /** A `*` / `true` / `1` entry — every host allowed (auth still required). */
  anyHost: boolean;
  /** Normalized hostname entries (a bare domain also covers its subdomains). */
  hostEntries: string[];
  /** IPv4/IPv6 literal, IPv4 wildcard or IPv4 CIDR entries. */
  ipEntries: string[];
}

export type RemotePluginAdminMatchSource = "any" | "host" | "client-ip";

export interface RemotePluginAdminScope {
  /** The env allow-list had at least one entry. */
  configured: boolean;
  /** This request's host or trusted client IP matched the allow-list. */
  matched: boolean;
  matchedBy: RemotePluginAdminMatchSource | null;
  /** Port-stripped, lower-cased Host header (informational / audit). */
  host: string | null;
  /** Trusted client IP used for address matching (informational / audit). */
  clientIp: string | null;
}

const EMPTY_ALLOW_LIST: RemotePluginAdminAllowList = {
  enabled: false,
  anyHost: false,
  hostEntries: [],
  ipEntries: [],
};

/** Parse the comma-separated allow-list. Pure — the unit-test entry point. */
export function parseRemotePluginAdminAllowList(
  raw: string | null | undefined
): RemotePluginAdminAllowList {
  if (typeof raw !== "string") return EMPTY_ALLOW_LIST;
  const tokens = raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return EMPTY_ALLOW_LIST;

  let anyHost = false;
  const hostEntries: string[] = [];
  const ipEntries: string[] = [];

  for (const token of tokens) {
    if (ANY_HOST_TOKENS.has(token)) {
      anyHost = true;
      continue;
    }
    if (IPV4_CIDR.test(token) || IPV4_WILDCARD.test(token) || token.includes(":")) {
      ipEntries.push(token);
      continue;
    }
    if (IPV4_LITERAL.test(token)) {
      ipEntries.push(token);
      continue;
    }
    // Hostname: strip a leading `*.` / `.` marker and any trailing dots.
    hostEntries.push(token.replace(/^\*?\./, "").replace(/\.+$/, ""));
  }

  return {
    enabled: anyHost || hostEntries.length > 0 || ipEntries.length > 0,
    anyHost,
    hostEntries: hostEntries.filter(Boolean),
    ipEntries,
  };
}

/** The currently configured allow-list (read per request; env only). */
export function getRemotePluginAdminAllowList(): RemotePluginAdminAllowList {
  return parseRemotePluginAdminAllowList(process.env[REMOTE_PLUGIN_ADMIN_HOSTS_ENV]);
}

/** `/api/plugins` and everything under it — the surface this carve-out covers. */
export function isPluginAdminPath(path: string): boolean {
  return path === "/api/plugins" || path.startsWith("/api/plugins/");
}

/** Strip the port, brackets and trailing dots from a `Host` header value. */
export function normalizeHostHeader(value: string | null | undefined): string | null {
  if (!value) return null;
  let host = value.trim().toLowerCase();
  if (!host) return null;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end >= 0 ? host.slice(1, end) : host.slice(1);
  } else if ((host.match(/:/g) || []).length === 1) {
    host = host.split(":")[0];
  }
  host = host.replace(/^::ffff:/, "").replace(/\.+$/, "");
  return host || null;
}

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const ip = value
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, "");
  return ip || null;
}

function ipv4ToInt(ip: string): number | null {
  if (!IPV4_LITERAL.test(ip)) return null;
  const octets = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => !Number.isFinite(octet) || octet < 0 || octet > 255)) return null;
  return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

function matchesIpEntry(ip: string, entry: string): boolean {
  if (entry === ip) return true;

  if (IPV4_WILDCARD.test(entry)) {
    const prefix = entry.slice(0, -1); // "192.168.1."
    return ip.startsWith(prefix) && IPV4_LITERAL.test(ip);
  }

  if (IPV4_CIDR.test(entry)) {
    const [base, prefixRaw] = entry.split("/");
    const prefix = Number.parseInt(prefixRaw, 10);
    const baseInt = ipv4ToInt(base);
    const ipInt = ipv4ToInt(ip);
    if (baseInt === null || ipInt === null) return false;
    if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
    if (prefix === 0) return true;
    const mask = prefix === 32 ? 0xffffffff : ~((1 << (32 - prefix)) - 1) >>> 0;
    return (baseInt & mask) >>> 0 === (ipInt & mask) >>> 0;
  }

  return false;
}

/**
 * Hostname entry semantics: the entry matches itself and every subdomain.
 * `luqion.cn` therefore covers `luqion.cn` and `ai.luqion.cn`, which is what an
 * operator means by "the domain my router resolves".
 */
function matchesHostEntry(host: string, entry: string): boolean {
  if (host === entry) return true;
  return host.endsWith(`.${entry}`);
}

/**
 * Locality inputs for the carve-out. Kept separate from the auth decision so
 * `policies/management.ts` stays the single place that authenticates a
 * principal (dashboard session or manage-scope key).
 */
export function resolveRemotePluginAdminScope(request: RequestLike): RemotePluginAdminScope {
  const allowList = getRemotePluginAdminAllowList();
  const host = normalizeHostHeader(request.headers?.get?.("host") ?? null);

  const stampToken = process.env.OMNIROUTE_PEER_STAMP_TOKEN;
  const clientIp = normalizeIp(
    resolveStampedPeer(request.headers?.get?.(CLIENT_IP_HEADER) ?? null, stampToken) ??
      resolveStampedPeer(request.headers?.get?.(PEER_IP_HEADER) ?? null, stampToken) ??
      request.ip ??
      request.socket?.remoteAddress ??
      null
  );

  if (!allowList.enabled) {
    return { configured: false, matched: false, matchedBy: null, host, clientIp };
  }

  if (allowList.anyHost) {
    return { configured: true, matched: true, matchedBy: "any", host, clientIp };
  }

  if (host && allowList.hostEntries.some((entry) => matchesHostEntry(host, entry))) {
    return { configured: true, matched: true, matchedBy: "host", host, clientIp };
  }

  if (clientIp && allowList.ipEntries.some((entry) => matchesIpEntry(clientIp, entry))) {
    return { configured: true, matched: true, matchedBy: "client-ip", host, clientIp };
  }

  return { configured: true, matched: false, matchedBy: null, host, clientIp };
}
