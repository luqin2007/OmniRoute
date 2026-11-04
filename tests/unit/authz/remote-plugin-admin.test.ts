/**
 * `OMNIROUTE_REMOTE_PLUGIN_ADMIN_HOSTS` — opt-in carve-out for the plugin-admin
 * surface (Hard Rules #15 + #17).
 *
 * `/api/plugins` is Tier-1 LOCAL_ONLY *and* spawn-capable, so the manage-scope
 * bypass list can never cover it. This suite pins the three properties that
 * make the separate, configuration-only exception safe:
 *
 *   1. Default OFF — an unset allow-list keeps the exact pre-existing 403.
 *   2. Locality-scoped — the request's Host (or trusted client IP) must match;
 *      a non-matching Host still gets 403 LOCAL_ONLY.
 *   3. Principal-scoped — an unauthenticated remote caller still gets 403, even
 *      when the Host matches. Only a dashboard session or a manage-scope key
 *      is accepted.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import { cleanupTempDataDir } from "../../_setup/tempDataDir.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-remote-plugin-admin-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "remote-plugin-admin-secret";
process.env.OMNIROUTE_DISABLE_REDIS_AUTH_CACHE = "1";

const ENV_KEY = "OMNIROUTE_REMOTE_PLUGIN_ADMIN_HOSTS";
const STAMP_TOKEN = "remote-plugin-admin-stamp-token";

const core = await import("../../../src/lib/db/core.ts");
const apiKeysDb = await import("../../../src/lib/db/apiKeys.ts");
const settingsDb = await import("../../../src/lib/db/settings.ts");
const {
  parseRemotePluginAdminAllowList,
  normalizeHostHeader,
  isPluginAdminPath,
  resolveRemotePluginAdminScope,
} = await import("../../../src/server/authz/remotePluginAdmin.ts");

const ORIGINAL_JWT = process.env.JWT_SECRET;
const ORIGINAL_INITIAL = process.env.INITIAL_PASSWORD;
const ORIGINAL_STAMP = process.env.OMNIROUTE_PEER_STAMP_TOKEN;

function resetEnv() {
  delete process.env[ENV_KEY];
  delete process.env.OMNIROUTE_PEER_STAMP_TOKEN;
}

test.beforeEach(() => {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  resetEnv();
});

test.after(async () => {
  resetEnv();
  await cleanupTempDataDir(TEST_DATA_DIR);
  if (ORIGINAL_JWT === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_JWT;
  if (ORIGINAL_INITIAL === undefined) delete process.env.INITIAL_PASSWORD;
  else process.env.INITIAL_PASSWORD = ORIGINAL_INITIAL;
  if (ORIGINAL_STAMP === undefined) delete process.env.OMNIROUTE_PEER_STAMP_TOKEN;
  else process.env.OMNIROUTE_PEER_STAMP_TOKEN = ORIGINAL_STAMP;
});

// ─── allow-list parsing + matching ───────────────────────────────────────────

test("parser: unset / empty / whitespace → disabled", () => {
  for (const raw of [undefined, null, "", "   ", ",,,"]) {
    const list = parseRemotePluginAdminAllowList(raw as string | undefined);
    assert.equal(list.enabled, false, `expected ${JSON.stringify(raw)} to disable`);
    assert.equal(list.anyHost, false);
  }
});

test("parser: bare domain, explicit wildcard, IPv4 wildcard and CIDR all parse", () => {
  const list = parseRemotePluginAdminAllowList(
    " ai.luqion.cn , *.luqion.cn , 192.168.1.* , 192.168.1.0/24 , 10.0.0.7 "
  );
  assert.equal(list.enabled, true);
  assert.equal(list.anyHost, false);
  assert.deepEqual(list.hostEntries, ["ai.luqion.cn", "luqion.cn"]);
  assert.deepEqual(list.ipEntries, ["192.168.1.*", "192.168.1.0/24", "10.0.0.7"]);
});

test("parser: `*` / `true` / `1` mean any host (auth still required)", () => {
  for (const raw of ["*", "true", "1", "ANY"]) {
    assert.equal(parseRemotePluginAdminAllowList(raw).anyHost, true, raw);
  }
});

test("normalizeHostHeader: strips port, brackets, trailing dot, case", () => {
  assert.equal(normalizeHostHeader("AI.Luqion.CN:8443"), "ai.luqion.cn");
  assert.equal(normalizeHostHeader("ai.luqion.cn."), "ai.luqion.cn");
  assert.equal(normalizeHostHeader("[::1]:20128"), "::1");
  assert.equal(normalizeHostHeader(null), null);
  assert.equal(normalizeHostHeader("   "), null);
});

test("isPluginAdminPath: exact surface only, no sibling prefix bleed", () => {
  for (const p of ["/api/plugins", "/api/plugins/scan", "/api/plugins/demo/activate"]) {
    assert.equal(isPluginAdminPath(p), true, p);
  }
  for (const p of ["/api/plugin", "/api/plugins-x", "/api/pluginsfoo", "/api/mcp/status"]) {
    assert.equal(isPluginAdminPath(p), false, p);
  }
});

test("scope: disabled without the env var even for a matching Host", () => {
  const scope = resolveRemotePluginAdminScope(ctxHeaders({ host: "ai.luqion.cn" }).request);
  assert.equal(scope.configured, false);
  assert.equal(scope.matched, false);
});

test("scope: bare domain covers its subdomains", () => {
  process.env[ENV_KEY] = "luqion.cn";
  assert.equal(
    resolveRemotePluginAdminScope(ctxHeaders({ host: "ai.luqion.cn" }).request).matched,
    true
  );
  assert.equal(
    resolveRemotePluginAdminScope(ctxHeaders({ host: "luqion.cn" }).request).matched,
    true
  );
  assert.equal(
    resolveRemotePluginAdminScope(ctxHeaders({ host: "evil-luqion.cn" }).request).matched,
    false
  );
});

test("scope: IPv4 wildcard and CIDR match the trusted client IP, not x-forwarded-for", () => {
  process.env.OMNIROUTE_PEER_STAMP_TOKEN = STAMP_TOKEN;
  process.env[ENV_KEY] = "192.168.1.*";

  const stamped = ctxHeaders({
    host: "dash.example",
    "x-omniroute-client-ip": `${STAMP_TOKEN}|192.168.1.42`,
  }).request;
  const scope = resolveRemotePluginAdminScope(stamped);
  assert.equal(scope.matched, true);
  assert.equal(scope.matchedBy, "client-ip");

  // A spoofed x-forwarded-for must not count: peer-stamp resolves the client
  // from the token-protected header only.
  const spoofed = ctxHeaders({
    host: "dash.example",
    "x-forwarded-for": "192.168.1.42",
  }).request;
  assert.equal(resolveRemotePluginAdminScope(spoofed).matched, false);

  process.env[ENV_KEY] = "192.168.1.0/24";
  assert.equal(resolveRemotePluginAdminScope(stamped).matched, true);
  assert.equal(resolveRemotePluginAdminScope(spoofed).matched, false);
});

// ─── policy integration ──────────────────────────────────────────────────────

async function loadPolicy() {
  const mod = await import(`../../../src/server/authz/policies/management.ts?ts=${Date.now()}`);
  return mod.managementPolicy;
}

async function dashboardCookieHeader(): Promise<string> {
  assert.ok(process.env.JWT_SECRET, "JWT_SECRET must be set before minting the dashboard cookie");
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(secret);
  return `auth_token=${token}`;
}

function ctxHeaders(headers: Record<string, string>) {
  const request = {
    method: "GET",
    headers: new Headers(headers),
    url: "https://ai.luqion.cn/api/plugins",
    nextUrl: { pathname: "/api/plugins" },
  };
  return { request };
}

function remoteCtx(headers: Record<string, string>, path = "/api/plugins", method = "GET") {
  return {
    request: {
      method,
      headers: new Headers(headers),
      url: `https://ai.luqion.cn${path}`,
      nextUrl: { pathname: path },
    },
    classification: {
      routeClass: "MANAGEMENT" as const,
      reason: "management_api" as const,
      normalizedPath: path,
    },
    requestId: "req_remote_plugin_admin",
  };
}

async function prepareAuth() {
  process.env.JWT_SECRET = "test-jwt-secret-remote-plugin-admin";
  process.env.INITIAL_PASSWORD = "initial-pass";
  await settingsDb.updateSettings({ requireLogin: true });
}

test("policy: unset allow-list keeps 403 LOCAL_ONLY for a remote dashboard session (regression guard)", async () => {
  await prepareAuth();
  const cookie = await dashboardCookieHeader();
  const policy = await loadPolicy();

  const out = await policy.evaluate(remoteCtx({ host: "ai.luqion.cn", cookie }));
  assert.equal(out.allow, false);
  if (!out.allow) {
    assert.equal(out.status, 403);
    assert.equal(out.code, "LOCAL_ONLY");
  }
});

test("policy: matching Host + dashboard session → allow, auditable label", async () => {
  await prepareAuth();
  process.env[ENV_KEY] = "ai.luqion.cn";
  const cookie = await dashboardCookieHeader();
  const policy = await loadPolicy();

  const out = await policy.evaluate(remoteCtx({ host: "ai.luqion.cn", cookie }));
  assert.equal(out.allow, true);
  if (out.allow) {
    assert.equal(out.subject.kind, "dashboard_session");
    assert.equal(out.subject.id, "dashboard");
    assert.equal(out.subject.label, "remote-plugin-admin-dashboard-session");
  }
});

test("policy: matching Host but NO credential → still 403 LOCAL_ONLY", async () => {
  await prepareAuth();
  process.env[ENV_KEY] = "ai.luqion.cn";
  const policy = await loadPolicy();

  const out = await policy.evaluate(remoteCtx({ host: "ai.luqion.cn" }));
  assert.equal(out.allow, false);
  if (!out.allow) {
    assert.equal(out.status, 403);
    assert.equal(out.code, "LOCAL_ONLY");
  }
});

test("policy: cookie but NON-matching Host → 403 LOCAL_ONLY", async () => {
  await prepareAuth();
  process.env[ENV_KEY] = "ai.luqion.cn";
  const cookie = await dashboardCookieHeader();
  const policy = await loadPolicy();

  const out = await policy.evaluate(remoteCtx({ host: "attacker.example", cookie }));
  assert.equal(out.allow, false);
  if (!out.allow) {
    assert.equal(out.code, "LOCAL_ONLY");
  }
});

test("policy: matching Host + non-manage API key → 403 LOCAL_ONLY", async () => {
  await prepareAuth();
  process.env[ENV_KEY] = "ai.luqion.cn";
  const created = await apiKeysDb.createApiKey("chat-only", "remote-plugin-chat-only", ["chat"]);
  const policy = await loadPolicy();

  const out = await policy.evaluate(
    remoteCtx({ host: "ai.luqion.cn", authorization: `Bearer ${created.key}` })
  );
  assert.equal(out.allow, false);
  if (!out.allow) {
    assert.equal(out.code, "LOCAL_ONLY");
  }
});

test("policy: matching Host + manage-scope API key → allow", async () => {
  await prepareAuth();
  process.env[ENV_KEY] = "ai.luqion.cn";
  const created = await apiKeysDb.createApiKey("plugin-admin", "remote-plugin-admin-key", [
    "manage",
  ]);
  const policy = await loadPolicy();

  const out = await policy.evaluate(
    remoteCtx(
      { host: "ai.luqion.cn", authorization: `Bearer ${created.key}` },
      "/api/plugins/scan",
      "POST"
    )
  );
  assert.equal(out.allow, true);
  if (out.allow) {
    assert.equal(out.subject.kind, "management_key");
    assert.equal(out.subject.id, created.id);
    assert.equal(out.subject.label, "remote-plugin-admin-manage-scope");
  }
});

test("policy: the carve-out covers /api/plugins/** but not other spawn-capable roots", async () => {
  await prepareAuth();
  process.env[ENV_KEY] = "ai.luqion.cn";
  const cookie = await dashboardCookieHeader();
  const policy = await loadPolicy();

  const sibling = await policy.evaluate(
    remoteCtx({ host: "ai.luqion.cn", cookie }, "/api/cli-tools/runtime/foo")
  );
  assert.equal(sibling.allow, false);
  if (!sibling.allow) {
    assert.equal(sibling.code, "LOCAL_ONLY");
  }
});
