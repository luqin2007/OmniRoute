/**
 * Path helpers shared by the endpoint dispatcher and its tests.
 *
 * Kept dependency-free (no DB, no child processes) so the normalisation rules
 * can be exercised directly.
 *
 * @module plugins/endpointPath
 */

/** Prefixes a plugin endpoint may occupy. Everything else is off-limits. */
const ALLOWED_PREFIXES = ["/v1/", "/api/v1/"];

/**
 * Normalise `/api/v1/x` and `/v1/x` to one manifest-facing form (`/v1/x`), so a
 * plugin declares a single path and matches both mounts.
 */
export function toManifestPath(pathname: string): string {
  if (pathname.startsWith("/api/v1/")) return pathname.slice("/api".length);
  return pathname;
}

/** True when a path may be served by a plugin endpoint. */
export function isEndpointPathAllowed(pathname: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
