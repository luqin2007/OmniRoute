#!/usr/bin/env node
/**
 * opencode-free-lane — deploy / sync helper for the OmniRoute plugin of the same name.
 *
 * Three things have to line up for OmniRoute to serve opencode.ai's free tier (`/inference/v1`):
 *
 *   1. the REQUEST BODY must carry the official CLI tool declarations (`read`, `shell`)
 *      -> that is the plugin (`examples/plugins/opencode-free-lane`), installed into the
 *         plugins dir and marked active in the `plugins` table;
 *   2. the OUTBOUND HEADERS must carry the CLI identity (User-Agent + the four same-valued
 *      session headers) -> that is the provider node's `custom_headers_json`, because a plugin
 *      only ever sees inbound headers and can only rewrite the body;
 *   3. the credentials must resolve to `Authorization: Bearer public`
 *      -> that is the connection's `api_key` (written as plaintext; `decrypt()` passes anything
 *         without the `enc:v1:` prefix straight through).
 *
 * This script keeps (2) and the numeric/tool payload of (1) in sync with the upstream reference
 * implementation, which is the only place the fingerprint is actually defined.
 *
 * Usage:
 *   node scripts/ad-hoc/opencode-free-lane.mjs install [--force]
 *   node scripts/ad-hoc/opencode-free-lane.mjs sync [--check] [--dry-run] [--ref <tag>]
 *                                              [--update-template]
 *   node scripts/ad-hoc/opencode-free-lane.mjs status [--json]
 *
 * Configuration (first source wins):
 *   --config <path> | $OPENCODE_FREE_LANE_CONFIG | _artifacts/opencode-free-lane.config.json
 *   then the CLI flags below, then the environment.
 *
 *   --plugins-root <dir>        host path of the plugins VOLUME ($OPENCODE_FREE_LANE_PLUGINS_ROOT)
 *                               -> plugin dir is <root>/opencode-free-lane
 *   --plugin-dir <dir>          explicit plugin dir (must end in "opencode-free-lane")
 *   --db <file>                 host path of storage.sqlite       ($OMNIROUTE_DB)
 *   --container-plugins-dir     container path of that volume     ($OPENCODE_FREE_LANE_CONTAINER_DIR)
 *   --repo <owner/name>         upstream reference repo           ($OPENCODE_FREE_LANE_REPO)
 *   --node-id <id>              provider node id to upsert        ($OPENCODE_FREE_LANE_NODE_ID)
 *
 * Exit codes: 0 ok, 1 error, 3 = `sync --check` found an update available (cron-friendly),
 * 4 = upstream moved its fingerprint definitions and the change needs a human (also cron-friendly:
 * a cron job should alert on it rather than retry).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { parse as acornParse } from "acorn";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const TEMPLATE_DIR = join(REPO_ROOT, "examples", "plugins", "opencode-free-lane");
const PLUGIN_NAME = "opencode-free-lane";
const PLUGIN_FILES = ["plugin.json", "index.mjs", "fingerprint.mjs", "lane-profile.json"];

const DEFAULTS = {
  repo: "Ebony-Vinyl/dsh-our-free-model",
  nodeId: "openai-compatible-chat-opencode-free",
  nodeName: "OpenCode Free Lane",
  nodePrefix: "opencode-free",
  nodeBaseUrl: "https://opencode.ai/inference/v1",
  containerPluginsDir: "/app/data/plugins",
  chatPath: "/inference/v1/chat/completions",
  modelsPath: "/inference/v1/models",
  sessionSignal: "opencode-free-lane@omniroute",
};


// ─────────────────────────────────────────── args / config

function parseArgv(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const key = (eq === -1 ? token.slice(2) : token.slice(2, eq)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (eq !== -1) {
      flags[key] = token.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { flags, positional };
}

function loadConfig(flags) {
  const candidates = [
    flags.config,
    process.env.OPENCODE_FREE_LANE_CONFIG,
    join(REPO_ROOT, "_artifacts", "opencode-free-lane.config.json"),
  ].filter(Boolean);

  let fileConfig = {};
  let configPath = null;
  for (const candidate of candidates) {
    const path = resolve(String(candidate));
    if (existsSync(path)) {
      fileConfig = JSON.parse(readFileSync(path, "utf8"));
      configPath = path;
      break;
    }
  }

  const pick = (flagKey, envKey, fallback) => {
    if (flags[flagKey] !== undefined && flags[flagKey] !== true) return String(flags[flagKey]);
    if (fileConfig[flagKey] !== undefined && fileConfig[flagKey] !== null) return String(fileConfig[flagKey]);
    if (envKey && process.env[envKey]) return process.env[envKey];
    return fallback;
  };

  const pluginsRoot = pick("pluginsRoot", "OPENCODE_FREE_LANE_PLUGINS_ROOT", null);
  const explicitPluginDir = pick("pluginDir", "OPENCODE_FREE_LANE_PLUGIN_DIR", null);

  return {
    configPath,
    repo: pick("repo", "OPENCODE_FREE_LANE_REPO", DEFAULTS.repo),
    pluginsRoot,
    pluginDir: explicitPluginDir ?? (pluginsRoot ? join(pluginsRoot, PLUGIN_NAME) : null),
    dbPath: pick("db", "OMNIROUTE_DB", null),
    containerPluginsDir: pick("containerPluginsDir", "OPENCODE_FREE_LANE_CONTAINER_DIR", DEFAULTS.containerPluginsDir),
    nodeId: pick("nodeId", "OPENCODE_FREE_LANE_NODE_ID", DEFAULTS.nodeId),
    nodeName: pick("nodeName", "OPENCODE_FREE_LANE_NODE_NAME", DEFAULTS.nodeName),
    nodePrefix: pick("nodePrefix", "OPENCODE_FREE_LANE_NODE_PREFIX", DEFAULTS.nodePrefix),
    nodeBaseUrl: pick("nodeBaseUrl", "OPENCODE_FREE_LANE_NODE_BASE_URL", DEFAULTS.nodeBaseUrl),
    chatPath: pick("chatPath", null, DEFAULTS.chatPath),
    modelsPath: pick("modelsPath", null, DEFAULTS.modelsPath),
    sessionSignal: pick("sessionSignal", null, DEFAULTS.sessionSignal),
  };
}

function requirePluginDir(config) {
  if (!config.pluginDir) {
    fail(
      "no plugin dir configured — pass --plugins-root <volume> (preferred) or --plugin-dir <dir>, " +
        "or write _artifacts/opencode-free-lane.config.json"
    );
  }
  const dir = resolve(config.pluginDir);
  // The loader scans <plugins dir>/<plugin name>/plugin.json — a dir that is not named after the
  // plugin is the volume root, and installing there produces files the scanner never pairs up.
  if (basename(dir) !== PLUGIN_NAME) {
    fail(
      `plugin dir must be named "${PLUGIN_NAME}" (got ${dir}) — did you mean ` +
        `--plugins-root ${dir} instead of --plugin-dir?`
    );
  }
  return dir;
}

function requireDb(config) {
  if (!config.dbPath) fail("no database configured — pass --db or write _artifacts/opencode-free-lane.config.json");
  const path = resolve(config.dbPath);
  if (!existsSync(path)) fail(`database not found: ${path}`);
  return path;
}

function fail(message) {
  process.stderr.write(`opencode-free-lane: ${message}\n`);
  process.exit(1);
}

const say = (message) => process.stdout.write(`${message}\n`);
const step = (message) => process.stdout.write(`  ${message}\n`);

// ─────────────────────────────────────────── session id

/** The session-id construction lives with the rest of the fingerprint, in the plugin module —
 *  one implementation, so the script can never drift from what the plugin ships. */
const { isCanonicalSession, isFreshSession, mintSessionId, sessionTimestampMs } = await import(
  pathToFileURL(join(TEMPLATE_DIR, "fingerprint.mjs")).href
);

// ─────────────────────────────────────────── upstream parsing (acorn, never eval)

/** The reference implementation is a JS module, not JSON: single-quoted strings and trailing
 *  commas. Parse it and read literals out of the AST rather than eval-ing anything. */
function parseUpstreamSource(source) {
  const ast = acornParse(source, { ecmaVersion: "latest", sourceType: "module" });
  const found = {};

  for (const node of ast.body) {
    if (node.type !== "VariableDeclaration") continue;
    for (const declarator of node.declarations) {
      if (declarator.id?.type !== "Identifier") continue;
      const name = declarator.id.name;
      if (name === "FINGERPRINT_TOOL_DEFINITIONS") found.tools = literalToValue(declarator.init);
      else if (name === "FINGERPRINT_TOOLS") found.toolNames = literalToValue(declarator.init);
      else if (name === "CLIENT_UA") found.userAgent = literalToValue(declarator.init);
      else if (name === "UPSTREAM_BASE") found.baseUrl = literalToValue(declarator.init);
      else if (name === "SESSION_RE") found.sessionRe = { pattern: declarator.init?.regex?.pattern, flags: declarator.init?.regex?.flags };
      else if (name === "SESSION_DESCENDING_RE")
        found.sessionDescendingRe = { pattern: declarator.init?.regex?.pattern, flags: declarator.init?.regex?.flags };
    }
  }

  // `X ?? 'fallback'` / `A || 'fallback'` — take the literal side, ignore the env lookup.
  if (found.baseUrl === undefined) found.baseUrl = null;
  return found;
}

function literalToValue(node) {
  if (!node) return undefined;
  switch (node.type) {
    case "Literal":
      return node.regex ? { __regex: node.regex.pattern, flags: node.regex.flags } : node.value;
    case "TemplateLiteral":
      return node.expressions.length === 0 ? node.quasis.map((q) => q.value.cooked).join("") : undefined;
    case "ArrayExpression":
      return node.elements.map((element) => literalToValue(element));
    case "ObjectExpression": {
      const out = {};
      for (const property of node.properties) {
        if (property.type !== "Property") continue;
        const key =
          property.key.type === "Identifier"
            ? property.key.name
            : property.key.type === "Literal"
              ? String(property.key.value)
              : undefined;
        if (key === undefined) continue;
        out[key] = literalToValue(property.value);
      }
      return out;
    }
    case "LogicalExpression": {
      const right = literalToValue(node.right);
      if (right !== undefined) return right;
      return literalToValue(node.left);
    }
    case "UnaryExpression":
      return node.operator === "-" ? -literalToValue(node.argument) : undefined;
    default:
      return undefined;
  }
}

// ─────────────────────────────────────────── github

async function githubJson(path) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "omniroute-opencode-free-lane" };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) fail(`GitHub API ${path} -> ${response.status} ${response.statusText}`);
  return response.json();
}

/**
 * `v1.2.3` / `1.2.3` only. The repository also publishes community desktop builds
 * (`v2.8.0-macos-unofficial`, …): they carry the same tree but are built by third parties and
 * must never drive the profile we install, because a stale or re-cut community build would
 * silently claim a ref the upstream lane never published.
 */
const PLAIN_TAG_RE = /^v?\d+\.\d+\.\d+$/;

async function semverTags(repo) {
  const tags = await githubJson(`/repos/${repo}/tags?per_page=30`);
  return (tags ?? [])
    .map((entry) => entry?.name)
    .filter((name) => typeof name === "string" && PLAIN_TAG_RE.test(name));
}

async function latestReleaseTag(repo) {
  let release = null;
  try {
    release = await githubJson(`/repos/${repo}/releases/latest`);
  } catch (error) {
    step(`releases/latest unavailable (${error.message}); falling back to tags`);
  }

  if (release?.tag_name && PLAIN_TAG_RE.test(release.tag_name)) {
    return { tag: release.tag_name, publishedAt: release.published_at ?? null };
  }
  if (release?.tag_name) step(`skipping ${release.tag_name} (community build, not a plain semver tag)`);

  const plain = await semverTags(repo);
  if (plain.length > 0) {
    step(`using ${plain[0]} from the semver tags (${plain.length} found)`);
    return { tag: plain[0], publishedAt: null };
  }

  if (release?.tag_name) return { tag: release.tag_name, publishedAt: release.published_at ?? null };

  const tags = await githubJson(`/repos/${repo}/tags?per_page=1`);
  if (!tags?.length) fail(`no tags found for ${repo}`);
  return { tag: tags[0].name, publishedAt: null };
}

async function fetchUpstreamSource(repo, ref) {
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/src/upstream.js`;
  const response = await fetch(url, { headers: { "User-Agent": "omniroute-opencode-free-lane" } });
  if (!response.ok) fail(`fetch ${url} -> ${response.status} ${response.statusText}`);
  return response.text();
}

// ─────────────────────────────────────────── profile

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function profilePath(pluginDir) {
  return join(pluginDir, "lane-profile.json");
}

function readProfile(pluginDir) {
  const path = profilePath(pluginDir);
  return existsSync(path) ? readJson(path) : null;
}

function buildHeaders(profile) {
  const session = profile.upstream.session;
  const userAgent = profile.upstream.userAgent;
  return {
    "User-Agent": userAgent,
    "x-opencode-client": "cli",
    "x-opencode-session": session,
    "x-opencode-session-id": session,
    "x-session-affinity": session,
    "x-session-id": session,
    "x-opencode-project": "global",
  };
}

function buildProfile({ upstream, previous, config, ref, publishedAt, newSession = false }) {
  // Mint ONCE and keep it. The upstream rejects hash-derived ids (their hex does not decode to a
  // real creation time) and it rejects a brand-new id on every request just as hard, so a stored
  // fresh id is reused and only replaced when it is missing, legacy-shaped, or expired.
  const previousSession = previous?.upstream?.session;
  const session =
    !newSession && isFreshSession(previousSession) ? previousSession : mintSessionId();
  if (!isCanonicalSession(session)) fail(`generated session id is malformed: ${session}`);
  if (!isFreshSession(session)) fail(`minted session id does not encode a real timestamp: ${session}`);

  const version = /(\d+\.\d+\.\d+)/.exec(upstream.userAgent ?? "")?.[1] ?? previous?.version ?? "0.0.0";

  return {
    schema: previous?.schema ?? 1,
    version,
    collisionPolicy: previous?.collisionPolicy ?? "override",
    match: previous?.match ?? {
      providerIds: [config.nodeId],
      modelPrefixes: [`${config.nodePrefix}/`],
      baseUrls: [new URL(config.nodeBaseUrl).hostname],
    },
    toolNames: upstream.toolNames ?? previous?.toolNames ?? ["read", "shell"],
    tools: upstream.tools ?? previous?.tools ?? {},
    upstream: {
      baseUrl: upstream.baseUrl || new URL(config.nodeBaseUrl).origin,
      chatPath: config.chatPath,
      modelsPath: config.modelsPath,
      userAgent: upstream.userAgent ?? previous?.upstream?.userAgent ?? null,
      sessionSignal: config.sessionSignal,
      session,
      headers: null, // filled below
      generatedAt: new Date().toISOString(),
      generatedBy: "scripts/ad-hoc/opencode-free-lane.mjs",
      source: ref ? "upstream-sync" : previous?.upstream?.source ?? "embedded-baseline",
      repo: config.repo,
      ref: ref ?? previous?.upstream?.ref ?? null,
      publishedAt: publishedAt ?? previous?.upstream?.publishedAt ?? null,
    },
    // Observability only — the plugin ignores this field.
    fingerprint: {
      sessionRe: upstream.sessionRe?.pattern ?? null,
      sessionDescendingRe: upstream.sessionDescendingRe?.pattern ?? null,
    },
  };
}

function withHeaders(profile) {
  profile.upstream.headers = buildHeaders(profile);
  return profile;
}

// ─────────────────────────────────────────── database

async function openDb(path) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

function upsertNode(db, config, headers) {
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id, name, prefix, api_type, base_url, custom_headers_json FROM provider_nodes WHERE id = ?").get(config.nodeId);
  const customHeadersJson = JSON.stringify(headers);

  if (!existing) {
    db.prepare(
      `INSERT INTO provider_nodes (id, type, name, prefix, api_type, base_url, chat_path, models_path, custom_headers_json, created_at, updated_at)
       VALUES (?, 'openai-compatible', ?, ?, 'chat', ?, NULL, NULL, ?, ?, ?)`
    ).run(config.nodeId, config.nodeName, config.nodePrefix, config.nodeBaseUrl, customHeadersJson, now, now);
    return { action: "inserted", id: config.nodeId };
  }

  db.prepare("UPDATE provider_nodes SET name = ?, prefix = ?, base_url = ?, custom_headers_json = ?, updated_at = ? WHERE id = ?").run(
    config.nodeName,
    config.nodePrefix,
    config.nodeBaseUrl,
    customHeadersJson,
    now,
    config.nodeId
  );
  return { action: "updated", id: config.nodeId };
}

function upsertConnection(db, config) {
  const existing = db.prepare("SELECT id, api_key FROM provider_connections WHERE provider = ? ORDER BY priority LIMIT 1").get(config.nodeId);

  const providerSpecificData = JSON.stringify({
    prefix: config.nodePrefix,
    apiType: "chat",
    baseUrl: config.nodeBaseUrl,
    nodeName: config.nodeName,
    autoFetchModels: true,
    autoSync: false,
    extraApiKeys: [],
    customUserAgent: "",
  });

  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE provider_connections SET api_key = ?, auth_type = 'apikey', name = ?, is_active = 1, provider_specific_data = ?, updated_at = ? WHERE id = ?`
    ).run("public", config.nodeName, providerSpecificData, now, existing.id);
    return { action: "updated", id: existing.id };
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO provider_connections (id, provider, auth_type, name, priority, is_active, api_key, provider_specific_data, test_status, created_at, updated_at)
     VALUES (?, ?, 'apikey', ?, 0, 1, 'public', ?, 'unknown', ?, ?)`
  ).run(id, config.nodeId, config.nodeName, providerSpecificData, now, now);
  return { action: "inserted", id };
}

function upsertPluginRow(db, config, pluginDir) {
  const manifest = readJson(join(pluginDir, "plugin.json"));
  const containerDir = `${config.containerPluginsDir.replace(/\/$/, "")}/${PLUGIN_NAME}`;
  const hooks = Object.entries(manifest.hooks ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id, status FROM plugins WHERE name = ?").get(PLUGIN_NAME);

  if (existing) {
    db.prepare(
      `UPDATE plugins SET version = ?, main = ?, manifest = ?, config_schema = ?, hooks = ?, plugin_dir = ?,
        status = 'active', enabled = 1, error_message = NULL, updated_at = ?, activated_at = COALESCE(activated_at, ?)
       WHERE name = ?`
    ).run(
      manifest.version,
      manifest.main,
      JSON.stringify(manifest),
      JSON.stringify(manifest.configSchema ?? {}),
      JSON.stringify(hooks),
      containerDir,
      now,
      now,
      PLUGIN_NAME
    );
    return { action: existing.status === "active" ? "already-active" : "activated", id: existing.id, containerDir };
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO plugins (id, name, version, description, author, license, main, source, tags, status, enabled,
       manifest, config, config_schema, hooks, permissions, plugin_dir, installed_at, updated_at, activated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'local', '[]', 'active', 1, ?, '{}', ?, ?, '[]', ?, ?, ?, ?)`
  ).run(
    id,
    PLUGIN_NAME,
    manifest.version,
    manifest.description ?? null,
    manifest.author ?? null,
    manifest.license ?? "MIT",
    manifest.main,
    JSON.stringify(manifest),
    JSON.stringify(manifest.configSchema ?? {}),
    JSON.stringify(hooks),
    containerDir,
    now,
    now,
    now
  );
  return { action: "inserted-active", id, containerDir };
}

function nodeHeadersMatch(db, config, headers) {
  const row = db.prepare("SELECT custom_headers_json FROM provider_nodes WHERE id = ?").get(config.nodeId);
  if (!row?.custom_headers_json) return false;
  try {
    const current = JSON.parse(row.custom_headers_json);
    for (const [key, value] of Object.entries(headers)) if (current[key] !== value) return false;
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────── commands

async function cmdInstall(config, flags) {
  const pluginDir = requirePluginDir(config);
  const dbPath = requireDb(config);

  say(`install ${PLUGIN_NAME}`);
  step(`template   ${TEMPLATE_DIR}`);
  step(`plugins    ${pluginDir}`);

  if (resolve(TEMPLATE_DIR) !== pluginDir) {
    mkdirSync(pluginDir, { recursive: true });
    for (const file of PLUGIN_FILES) {
      const source = join(TEMPLATE_DIR, file);
      if (!existsSync(source)) fail(`missing template file: ${source}`);
      const target = join(pluginDir, file);
      if (existsSync(target) && !flags.force) {
        const same = readFileSync(source, "utf8") === readFileSync(target, "utf8");
        step(`${file}${same ? " (unchanged)" : " (kept — use --force to overwrite)"}`);
        continue;
      }
      copyFileSync(source, target);
      step(`${file} (copied)`);
    }
  } else {
    step("plugin dir is the template dir — nothing to copy");
  }

  const profile = withHeaders(readProfile(pluginDir) ?? fail(`no lane-profile.json in ${pluginDir}`));
  writeFileSync(profilePath(pluginDir), `${JSON.stringify(profile, null, 2)}\n`);

  const db = await openDb(dbPath);
  try {
    say("database");
    step(`node       ${JSON.stringify(upsertNode(db, config, profile.upstream.headers))}`);
    step(`connection ${JSON.stringify(upsertConnection(db, config))}`);
    step(`plugin     ${JSON.stringify(upsertPluginRow(db, config, pluginDir))}`);
  } finally {
    db.close();
  }

  say("done — restart the container so the plugin registry picks up the new row:");
  say("  docker restart omniroute");
}

async function cmdSync(config, flags) {
  const pluginDir = requirePluginDir(config);
  const dbPath = flags.dbOnly ? null : config.dbPath ? resolve(config.dbPath) : null;
  const previous = readProfile(pluginDir);
  if (!previous) fail(`no lane-profile.json in ${pluginDir} — run install first`);

  say(`sync ${config.repo}`);
  const ref = flags.ref && flags.ref !== true ? String(flags.ref) : null;
  const release = ref ? { tag: ref, publishedAt: null } : await latestReleaseTag(config.repo);
  step(`latest release ${release.tag}${release.publishedAt ? ` (${release.publishedAt})` : ""}`);
  step(`installed ref  ${previous.upstream?.ref ?? "(embedded baseline)"}`);

  const source = await fetchUpstreamSource(config.repo, release.tag);
  const upstream = parseUpstreamSource(source);

  // `FINGERPRINT_TOOL_DEFINITIONS` moved out of `src/upstream.js` in v2.8.0 (the official CLI
  // tool set is now read from a captured JSON). When the shape changes we keep the installed
  // definitions, hold the ref back so the profile never claims a version its tools do not come
  // from, and report a distinct exit code so a cron run can page a human instead of silently
  // "succeeding" with a half-derived profile.
  const parsedTools =
    upstream.tools?.read && upstream.tools?.shell ? upstream.tools : null;
  const carriedTools =
    previous.tools?.read && previous.tools?.shell ? previous.tools : null;
  if (!parsedTools && !carriedTools) {
    fail(
      "could not extract `read`/`shell` tool definitions from upstream source and there is no installed profile to fall back to — port the fingerprint by hand"
    );
  }

  const next = withHeaders(
    buildProfile({
      upstream,
      previous,
      config,
      ref: parsedTools ? release.tag : null,
      publishedAt: parsedTools ? release.publishedAt : null,
      newSession: Boolean(flags.newSession),
    })
  );
  if (!parsedTools) next.upstream.pendingRef = release.tag;

  const changes = [];
  if (previous.upstream?.userAgent !== next.upstream.userAgent) changes.push(`userAgent ${previous.upstream?.userAgent} -> ${next.upstream.userAgent}`);
  if (previous.upstream?.ref !== next.upstream.ref) changes.push(`ref ${previous.upstream?.ref ?? "(baseline)"} -> ${next.upstream.ref}`);
  if (previous.upstream?.session !== next.upstream.session) changes.push(`session ${previous.upstream?.session} -> ${next.upstream.session}`);
  if (parsedTools && JSON.stringify(previous.tools) !== JSON.stringify(next.tools)) changes.push("tool definitions changed");
  if (!parsedTools) changes.push(`tool definitions NOT parseable at ${release.tag} (upstream moved them) — keeping the installed ones`);
  if (JSON.stringify(previous.toolNames) !== JSON.stringify(next.toolNames)) changes.push(`toolNames -> ${next.toolNames.join(",")}`);

  if (changes.length === 0) {
    say("already up to date — nothing to do");
    return 0;
  }

  say("changes");
  for (const change of changes) step(change);

  if (!parsedTools) {
    say(`upstream tool-definition shape changed at ${release.tag} — manual port required`);
    if (flags.check || flags.dryRun) return 4;
  }

  if (flags.check) {
    say("update available (--check: not writing)");
    return 3;
  }
  if (flags.dryRun) {
    say("--dry-run: not writing");
    return 0;
  }

  writeFileSync(profilePath(pluginDir), `${JSON.stringify(next, null, 2)}\n`);
  step(`wrote ${profilePath(pluginDir)}`);

  if (flags.updateTemplate && resolve(pluginDir) !== resolve(TEMPLATE_DIR)) {
    writeFileSync(profilePath(TEMPLATE_DIR), `${JSON.stringify(next, null, 2)}\n`);
    step(`wrote ${profilePath(TEMPLATE_DIR)} (repo template)`);
  }

  if (dbPath) {
    const db = await openDb(dbPath);
    try {
      step(`node headers ${JSON.stringify(upsertNode(db, config, next.upstream.headers))}`);
    } finally {
      db.close();
    }
  }

  say("done — the plugin re-reads lane-profile.json on change; no restart needed.");
  return 0;
}

/**
 * Rotate the session id without touching GitHub.
 *
 * The upstream wants an id minted from a real clock and then KEPT; a hash-derived one (what this
 * plugin used to write) is the documented failure mode. `sync` used to be the only path that
 * rebuilt the header, so a rate-limited GitHub API meant no way to fix an installed lane — this
 * command only touches the profile and the node row.
 */
async function cmdSession(config, flags) {
  const pluginDir = config.pluginDir ? resolve(config.pluginDir) : null;
  if (!pluginDir || !existsSync(pluginDir)) fail("plugin dir not found — run `install` first");

  const current = readProfile(pluginDir);
  if (!current) fail(`no lane-profile.json in ${pluginDir}`);

  const stored = current.upstream?.session ?? null;
  if (!flags.force && isFreshSession(stored)) {
    say(`session already minted and fresh (${stored}) — pass --force to rotate anyway`);
    return 0;
  }

  current.upstream.session = mintSessionId();
  current.upstream.sessionMintedAt = new Date().toISOString();
  const next = withHeaders(current);

  say(`session ${stored ?? "(none)"} -> ${next.upstream.session}`);
  // The id encodes only the low 36 bits of the timestamp, so the raw decode wraps (~794 days).
  const wrapMs = 2 ** 36;
  const nowMs = Date.now();
  const decoded = sessionTimestampMs(next.upstream.session);
  const ageMs = (((nowMs % wrapMs) - decoded) % wrapMs + wrapMs) % wrapMs;
  step(`decoded creation time ${new Date(nowMs - ageMs).toISOString()} (${Math.round(ageMs / 1000)}s ago)`);

  if (flags.dryRun) {
    say("--dry-run: not writing");
    return 0;
  }

  writeFileSync(profilePath(pluginDir), `${JSON.stringify(next, null, 2)}\n`);
  step(`wrote ${profilePath(pluginDir)}`);

  if (flags.updateTemplate && resolve(pluginDir) !== resolve(TEMPLATE_DIR)) {
    writeFileSync(profilePath(TEMPLATE_DIR), `${JSON.stringify(next, null, 2)}\n`);
    step(`wrote ${profilePath(TEMPLATE_DIR)} (repo template)`);
  }

  if (flags.dbOnly !== true && config.dbPath && existsSync(resolve(config.dbPath))) {
    const db = await openDb(resolve(config.dbPath));
    try {
      step(`node headers ${JSON.stringify(upsertNode(db, config, next.upstream.headers))}`);
    } finally {
      db.close();
    }
  }

  say("done — the plugin re-reads lane-profile.json on change; no restart needed.");
  return 0;
}

async function cmdStatus(config, flags) {
  const pluginDir = config.pluginDir ? resolve(config.pluginDir) : null;
  const report = { plugin: { name: PLUGIN_NAME, templateDir: TEMPLATE_DIR, pluginDir } };

  if (pluginDir && existsSync(pluginDir)) {
    const profile = readProfile(pluginDir);
    report.plugin.files = PLUGIN_FILES.map((file) => {
      const path = join(pluginDir, file);
      return existsSync(path) ? { file, bytes: statSync(path).size } : { file, missing: true };
    });
    report.plugin.profile = profile
      ? {
          version: profile.version,
          source: profile.upstream?.source ?? null,
          ref: profile.upstream?.ref ?? null,
          userAgent: profile.upstream?.userAgent ?? null,
          session: profile.upstream?.session ?? null,
          toolNames: profile.toolNames,
        }
      : null;
  } else {
    report.plugin.profile = null;
  }

  try {
    const release = await latestReleaseTag(config.repo);
    report.upstream = { repo: config.repo, latest: release.tag, publishedAt: release.publishedAt };
    report.upstream.updateAvailable = report.plugin.profile?.ref !== release.tag;
  } catch (error) {
    report.upstream = { repo: config.repo, error: error.message };
  }

  if (config.dbPath && existsSync(resolve(config.dbPath))) {
    const db = await openDb(resolve(config.dbPath));
    try {
      report.database = { path: resolve(config.dbPath) };
      report.database.node = db
        .prepare("SELECT id, name, prefix, base_url, custom_headers_json FROM provider_nodes WHERE id = ?")
        .get(config.nodeId) ?? null;
      report.database.connection = db
        .prepare("SELECT id, name, api_key, is_active FROM provider_connections WHERE provider = ?")
        .get(config.nodeId) ?? null;
      report.database.plugin = db.prepare("SELECT id, status, enabled, plugin_dir, version FROM plugins WHERE name = ?").get(PLUGIN_NAME) ?? null;
    } finally {
      db.close();
    }
  }

  if (flags.json) {
    say(JSON.stringify(report, null, 2));
    return 0;
  }

  say(`${PLUGIN_NAME} status`);
  step(`template      ${TEMPLATE_DIR}`);
  step(`plugins dir   ${pluginDir ?? "(not configured)"}`);
  if (report.plugin.profile) {
    step(`profile       v${report.plugin.profile.version} ref=${report.plugin.profile.ref ?? "(baseline)"} source=${report.plugin.profile.source}`);
    step(`user agent    ${report.plugin.profile.userAgent}`);
    step(`session       ${report.plugin.profile.session}`);
    step(`tools         ${report.plugin.profile.toolNames?.join(", ")}`);
  } else {
    step("profile       not installed");
  }
  if (report.upstream?.latest) {
    step(`upstream      ${report.upstream.latest}${report.upstream.updateAvailable ? "  <-- update available" : "  (current)"}`);
  } else if (report.upstream?.error) {
    step(`upstream      error: ${report.upstream.error}`);
  }
  if (report.database) {
    step(`node          ${report.database.node ? `${report.database.node.id} base_url=${report.database.node.base_url}` : "missing"}`);
    step(`headers       ${report.database.node?.custom_headers_json ? "set" : "not set"}`);
    step(`connection    ${report.database.connection ? `${report.database.connection.id} api_key=${report.database.connection.api_key} active=${report.database.connection.is_active}` : "missing"}`);
    step(`plugin row    ${report.database.plugin ? `${report.database.plugin.status} enabled=${report.database.plugin.enabled} dir=${report.database.plugin.plugin_dir}` : "missing"}`);
  } else {
    step("database      not configured");
  }
  return 0;
}

function printUsage() {
  say("usage: opencode-free-lane.mjs <install|sync|session|status> [options]");
  say("");
  say("  install              copy the plugin into the volume, upsert node/connection/plugin rows");
  say("  sync [--check]       pull the latest upstream source, rebuild lane-profile.json + node headers");
  say("  session [--force]    rotate the session id (real-timestamp mint, no GitHub call)");
  say("  status [--json]      report local vs upstream state");
  say("");
  say("options: --config --plugin-dir --db --container-plugins-dir --repo --node-id --ref --force");
  say("         --new-session --update-template --db-only --dry-run --check --json");
}

async function main() {
  const { flags, positional } = parseArgv(process.argv.slice(2));
  const command = positional[0];
  if (!command || flags.help) {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  const config = loadConfig(flags);
  const handlers = { install: cmdInstall, sync: cmdSync, session: cmdSession, status: cmdStatus };
  const handler = handlers[command];
  if (!handler) fail(`unknown command: ${command}`);

  const code = await handler(config, flags);
  process.exit(typeof code === "number" ? code : 0);
}

main().catch((error) => fail(error?.stack ?? String(error)));
