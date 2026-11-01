/**
 * opencode-free-lane — OmniRoute plugin.
 *
 * Makes OmniRoute able to serve the opencode.ai free tier (`/inference/v1`) by shape-shifting the
 * REQUEST BODY into what the upstream gate expects: the two official CLI tool declarations
 * (`read`, `shell`), verbatim, plus a normalized `tool_choice`.
 *
 * What lives here vs. elsewhere:
 *   - body fingerprint  -> this plugin (chatCore `onRequest` hook)
 *   - outbound headers  -> the provider node's `custom_headers_json` (a plugin cannot set them;
 *                          chatCore hands the plugin the INBOUND client headers, and the returned
 *                          value only ever replaces the request body)
 *   - auto-update       -> `scripts/ad-hoc/opencode-free-lane.mjs sync`, which rewrites
 *                          `lane-profile.json` next to this file (that file is re-read on change,
 *                          so no restart is needed)
 *
 * `onResponse` is deliberately NOT used: chatCore runs it fire-and-forget and discards its return
 * value, so it cannot rewrite anything the client sees.
 *
 * Authoritative spec this mirrors: dsh-our-free-model `src/upstream.js`.
 */
import { applyFingerprint, loadProfile, matchesLane } from "./fingerprint.mjs";

const DEBUG = process.env.OPENCODE_FREE_LANE_DEBUG === "1";
let loggedFirstMatch = false;
let suppressed = 0;

function note(message) {
  if (typeof console !== "undefined" && typeof console.log === "function") console.log(message);
}

/**
 * chatCore `onRequest` hook. Returning `{ body }` replaces the request body; returning nothing
 * (or throwing) leaves the request untouched — the host hook is fail-open by design.
 */
export async function onRequest(ctx) {
  try {
    const profile = loadProfile();
    if (!matchesLane(ctx, profile)) return undefined;

    const body = ctx?.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;

    const policy = process.env.OPENCODE_FREE_LANE_POLICY || profile.collisionPolicy || "override";
    const result = applyFingerprint(body, { profile, policy });
    if (!result.changed) return undefined;

    if (DEBUG || !loggedFirstMatch) {
      loggedFirstMatch = true;
      note(
        `[opencode-free-lane] model=${ctx?.model ?? "?"} provider=${ctx?.provider ?? "?"} ` +
          `policy=${policy} injected=[${result.injected.join(",")}] ` +
          `overridden=[${result.overridden.join(",")}] renamed=[${result.renamed
            .map(([alias, original]) => `${alias}<-${original}`)
            .join(",")}]` +
          (result.notes.length ? ` notes=[${result.notes.join(",")}]` : "")
      );
    } else {
      suppressed += 1;
      if (suppressed % 500 === 0) note(`[opencode-free-lane] ${suppressed} further requests fingerprinted`);
    }

    return {
      body: result.body,
      metadata: {
        "opencode-free-lane": {
          profileVersion: profile.version,
          policy,
          injected: result.injected,
          overridden: result.overridden,
          renamed: result.renamed,
        },
      },
    };
  } catch (error) {
    // Never break a request over the fingerprint.
    note(`[opencode-free-lane] onRequest failed: ${error?.message ?? error}`);
    return undefined;
  }
}

/** Exported for local testing only — the host never calls this. */
export const __internals = { applyFingerprint, loadProfile, matchesLane };
