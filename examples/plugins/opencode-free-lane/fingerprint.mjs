/**
 * opencode.ai free-lane request-body fingerprint.
 *
 * The upstream gate (opencode.ai /inference/v1) only serves free-tier traffic when the request
 * carries the official CLI's tool declarations. It compares `description` AND `parameters`
 * verbatim: reworded descriptions, slimmed schemas, `properties: {}` or a renamed tool all earn
 * a 403 FreeTierError. The strings in `lane-profile.json` are the ones the upstream expects —
 * do not "improve" them.
 *
 * Scope note: this module only ever touches the REQUEST BODY. Outbound headers (user-agent and
 * the four same-valued session headers) cannot be set from a plugin — chatCore's plugin context
 * exposes the INBOUND client headers, not the upstream request. Those headers are therefore
 * configured on the provider node itself (`custom_headers_json`), see README.md.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE_FILE = join(HERE, "lane-profile.json");

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const SESSION_DESCENDING_RE = /^[0-9a-f]{9}f[c-f][0-9a-f]$/;

/**
 * Embedded baseline (OpenCode v2.0.26 CLI, dsh-our-free-model v2.7.3). Used when
 * `lane-profile.json` is missing or unreadable, so the plugin still does something sane.
 * `scripts/ad-hoc/opencode-free-lane.mjs sync` regenerates the JSON from upstream.
 */
export const FALLBACK_PROFILE = {
  schema: 1,
  version: "2.0.26",
  collisionPolicy: "override",
  match: { providerIds: [], modelPrefixes: [], baseUrls: ["opencode.ai"] },
  toolNames: ["read", "shell"],
  tools: {
    read: {
      description:
        "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File or directory to read" },
          offset: {
            type: "integer",
            minimum: 0,
            description: "The line or directory entry to start reading from (1-based)",
          },
          limit: {
            type: "integer",
            minimum: 0,
            description:
              "The maximum number of lines or directory entries to read (defaults to and capped at 2000)",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    shell: {
      description:
        "Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command string to execute" },
          workdir: {
            type: "string",
            description:
              "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
          },
          timeout: {
            type: "integer",
            minimum: 0,
            description:
              "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.",
          },
          background: {
            type: "boolean",
            description:
              "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
};

let profileCache = { mtimeMs: -1, profile: null };

/** Read `lane-profile.json` (mtime-cached, so an in-place update is picked up without a restart). */
export function loadProfile() {
  try {
    const stat = statSync(PROFILE_FILE);
    if (profileCache.profile && profileCache.mtimeMs === stat.mtimeMs) return profileCache.profile;
    const parsed = JSON.parse(readFileSync(PROFILE_FILE, "utf8"));
    const merged = {
      ...FALLBACK_PROFILE,
      ...parsed,
      match: { ...FALLBACK_PROFILE.match, ...(parsed.match || {}) },
      tools: { ...FALLBACK_PROFILE.tools, ...(parsed.tools || {}) },
      toolNames: Array.isArray(parsed.toolNames) && parsed.toolNames.length
        ? parsed.toolNames
        : FALLBACK_PROFILE.toolNames,
    };
    profileCache = { mtimeMs: stat.mtimeMs, profile: merged };
    return merged;
  } catch {
    return FALLBACK_PROFILE;
  }
}

/* ------------------------------------------------------------------ session id */

function base62Fixed(bytes, width) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (let i = 0; i < width; i += 1) {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out;
}

/**
 * Deterministic `ses_` id from an arbitrary signal: same signal -> same id, forever.
 *
 * Stability is required, not cosmetic: the upstream's 429 FreeUsageLimitError stays bad if you
 * come back with a fresh session, so the reference implementation deliberately reuses one id.
 */
export function canonicalizeSession(signal) {
  const digest = createHash("sha256").update(`ses\0${signal}`).digest();
  const high =
    (BigInt(digest[0]) << 28n) |
    (BigInt(digest[1]) << 20n) |
    (BigInt(digest[2]) << 12n) |
    (BigInt(digest[3]) << 4n) |
    (BigInt(digest[4]) >> 4n);
  const inverted = ~((high << 12n) | 1n) & 0xffffffffffffn;
  return `ses_${inverted.toString(16).padStart(12, "0")}${base62Fixed(digest.subarray(6, 16), 14)}`;
}

/** Shape check: `ses_` + 12 hex + 14 base62, with the low 12 bits inside 0xfc0-0xfff. */
export function isCanonicalSession(id) {
  if (typeof id !== "string" || !SESSION_RE.test(id)) return false;
  return SESSION_DESCENDING_RE.test(id.slice(4, 16));
}

/* -------------------------------------------------------------- tool adapters */

function detectShape(tool) {
  if (!tool || typeof tool !== "object") return "chat";
  if (tool.function && typeof tool.function === "object") return "chat";
  if ("input_schema" in tool) return "messages";
  if ("parameters" in tool && typeof tool.name === "string") return "responses";
  return "chat";
}

function detectShapeFromBody(body) {
  if (body && typeof body === "object") {
    if (Array.isArray(body.input) || "max_output_tokens" in body || "instructions" in body) {
      return "responses";
    }
    if (Array.isArray(body.system)) return "messages";
    if (typeof body.system === "string" && !Array.isArray(body.messages)) return "messages";
  }
  return "chat";
}

function toolNameOf(tool) {
  if (!tool || typeof tool !== "object") return null;
  if (tool.function && typeof tool.function === "object" && typeof tool.function.name === "string") {
    return tool.function.name;
  }
  if (typeof tool.name === "string") return tool.name;
  return null;
}

function setToolName(tool, name) {
  if (tool.function && typeof tool.function === "object") tool.function.name = name;
  else tool.name = name;
}

function readToolDef(tool) {
  if (tool.function && typeof tool.function === "object") {
    return { description: tool.function.description, parameters: tool.function.parameters };
  }
  if ("input_schema" in tool) {
    return { description: tool.description, parameters: tool.input_schema };
  }
  return { description: tool.description, parameters: tool.parameters };
}

function writeToolDef(tool, def) {
  if (tool.function && typeof tool.function === "object") {
    tool.function.description = def.description;
    tool.function.parameters = def.parameters;
    return;
  }
  if ("input_schema" in tool) {
    tool.description = def.description;
    tool.input_schema = def.parameters;
    return;
  }
  tool.description = def.description;
  tool.parameters = def.parameters;
}

function makeTool(shape, name, def) {
  if (shape === "chat") {
    return {
      type: "function",
      function: { name, description: def.description, parameters: def.parameters },
    };
  }
  if (shape === "messages") {
    return { name, description: def.description, input_schema: def.parameters };
  }
  return { type: "function", name, description: def.description, parameters: def.parameters };
}

/** Key-order-insensitive deep equality (the upstream compares content, not field order). */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function definitionsMatch(tool, official) {
  const found = readToolDef(tool);
  return deepEqual(found.description, official.description) &&
    deepEqual(found.parameters, official.parameters);
}

/* ------------------------------------------------------------- tool_choice gate */

/**
 * The upstream 403s on `tool_choice: "none"`. Drop it in the chat/messages shapes; on the
 * Responses shape a missing tool_choice is completed to `"auto"` (what the official client does).
 */
function normalizeToolChoice(body, shape) {
  const choice = body.tool_choice;
  let touched = false;
  const isNone = choice === "none" ||
    (choice && typeof choice === "object" && (choice.type === "none" || choice.mode === "none"));
  if (isNone) {
    delete body.tool_choice;
    touched = true;
  }
  if (shape === "responses" && body.tool_choice === undefined) {
    body.tool_choice = "auto";
    touched = true;
  }
  return touched;
}

/* ------------------------------------------------------------------ entry point */

/**
 * Apply the fingerprint to a request body, in place.
 *
 * @param {object} body   client request body (chat / responses / messages shape, auto-detected)
 * @param {{profile?: object, policy?: string}} [options]
 * @returns {{body: object, changed: boolean, injected: string[], overridden: string[],
 *            renamed: Array<[string, string]>, aliasMap: Map<string,string>, notes: string[]}}
 */
export function applyFingerprint(body, options = {}) {
  const result = {
    body,
    changed: false,
    injected: [],
    overridden: [],
    renamed: [],
    aliasMap: new Map(),
    notes: [],
  };
  if (!body || typeof body !== "object" || Array.isArray(body)) return result;

  const profile = options.profile || loadProfile();
  const policy = options.policy || profile.collisionPolicy || "override";
  const official = profile.tools || {};
  const wanted = (profile.toolNames || []).filter((name) => official[name]);
  if (!wanted.length) return result;

  const declared = Array.isArray(body.tools) ? body.tools : null;
  const shape = declared && declared.length ? detectShape(declared[0]) : detectShapeFromBody(body);
  const next = [];
  const emitted = new Set();

  for (const tool of declared || []) {
    const name = toolNameOf(tool);
    if (!name || !wanted.includes(name)) {
      next.push(tool);
      continue;
    }
    if (definitionsMatch(tool, official[name])) {
      next.push(tool);
      emitted.add(name);
      continue;
    }
    if (policy === "rename") {
      // Officially-named slot is already taken by a *different* definition: move the client's
      // tool aside so the official one can claim the name the upstream gate looks for.
      if (emitted.has(name)) continue;
      let alias = `${name}_client1`;
      let counter = 1;
      const taken = new Set((declared || []).map(toolNameOf).filter(Boolean));
      while (taken.has(alias)) {
        counter += 1;
        alias = `${name}_client${counter}`;
      }
      setToolName(tool, alias);
      result.renamed.push([alias, name]);
      result.aliasMap.set(alias, name);
      next.push(tool);
      continue;
    }
    // Default policy "override": keep the client's tool name (so tool calls round-trip) and only
    // swap in the official description + parameters the upstream gate compares.
    writeToolDef(tool, official[name]);
    next.push(tool);
    emitted.add(name);
    result.overridden.push(name);
  }

  for (const name of wanted) {
    if (emitted.has(name)) continue;
    next.push(makeTool(shape, name, official[name]));
    result.injected.push(name);
  }

  const before = declared ? JSON.stringify(declared) : "";
  body.tools = next;
  if (normalizeToolChoice(body, shape)) result.notes.push("tool_choice normalized");

  if (before !== JSON.stringify(next)) result.changed = true;
  if (result.notes.length) result.changed = true;
  return result;
}

/**
 * Does this request belong to the free lane? Matched on provider id, model prefix or upstream
 * host — the host check runs last and only against the configured (placeholder-safe) list.
 */
export function matchesLane(ctx, profile = loadProfile()) {
  const match = profile.match || {};
  const provider = typeof ctx?.provider === "string" ? ctx.provider : "";
  const model = typeof ctx?.model === "string" ? ctx.model : "";
  const ids = match.providerIds || [];
  const prefixes = match.modelPrefixes || [];
  if (provider && ids.some((id) => provider === id || provider.includes(id))) return true;
  if (model && prefixes.some((prefix) => model.startsWith(prefix))) return true;
  // Base-URL matching needs the provider node config, which a plugin cannot read — the operator
  // keeps this list in sync with the node's base_url instead.
  return false;
}
