/**
 * `examples/plugins/opencode-free-lane/fingerprint.mjs` — the opencode.ai free-tier request
 * shape shifter.
 *
 * Everything asserted here is the gate contract as measured upstream (see the plugin header and
 * `docs/` notes): the body must declare the two official CLI tools (`read`, `shell`) verbatim,
 * a client tool that squats one of those names must not survive with its own definition, and
 * session ids must keep the minted `ses_` shape. Pure functions, no network, no profiles on disk
 * beyond the shipped `lane-profile.json`.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFingerprint,
  canonicalizeSession,
  isCanonicalSession,
  loadProfile,
  matchesLane,
} from "../../examples/plugins/opencode-free-lane/fingerprint.mjs";

type AnyTool = Record<string, unknown>;

function nameOf(tool: AnyTool): string {
  const fn = tool.function as { name?: string } | undefined;
  return typeof tool.name === "string" ? tool.name : (fn?.name ?? "");
}

function defOf(tool: AnyTool): { description?: unknown; parameters?: unknown } {
  const fn = tool.function as { description?: unknown; parameters?: unknown } | undefined;
  return fn ? { description: fn.description, parameters: fn.parameters } : tool;
}

const profile = loadProfile();

test("the shipped profile carries both official tool definitions", () => {
  assert.deepEqual([...profile.toolNames], ["read", "shell"]);
  assert.ok(profile.tools.read?.description);
  assert.ok(profile.tools.shell?.description);
  assert.equal(typeof profile.upstream?.userAgent, "string");
  assert.match(profile.upstream.userAgent, /^opencode\/(?:latest\/)?\d+\.\d+\.\d+\/cli$/);
});

test("a body with no tools gets both official tools injected", () => {
  const body: Record<string, unknown> = {
    model: "deepseek-v4.1-flash-free",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = applyFingerprint(body, { profile });

  assert.equal(result.changed, true);
  assert.deepEqual([...result.injected], ["read", "shell"]);
  const tools = body.tools as AnyTool[];
  assert.equal(tools.length, 2);
  assert.deepEqual(
    tools.map(nameOf).sort(),
    ["read", "shell"]
  );
  for (const tool of tools) {
    const official = profile.tools[nameOf(tool)];
    const def = defOf(tool);
    assert.equal(def.description, official.description);
    assert.deepEqual(def.parameters, official.parameters);
  }
});

test("an unrelated client tool is preserved untouched", () => {
  const clientTool = {
    type: "function",
    function: { name: "grep", description: "client grep", parameters: { type: "object" } },
  };
  const body: Record<string, unknown> = { tools: [clientTool] };
  applyFingerprint(body, { profile });

  const tools = body.tools as AnyTool[];
  assert.equal(tools.length, 3);
  assert.ok(tools.includes(clientTool));
});

test("policy=override swaps in the official definition and keeps the name", () => {
  const body: Record<string, unknown> = {
    tools: [
      {
        type: "function",
        function: { name: "read", description: "my own read", parameters: { type: "object" } },
      },
    ],
  };
  const result = applyFingerprint(body, { profile, policy: "override" });

  const tools = body.tools as AnyTool[];
  const read = tools.find((tool) => nameOf(tool) === "read");
  assert.ok(read);
  const def = defOf(read);
  assert.equal(def.description, profile.tools.read.description);
  assert.deepEqual(def.parameters, profile.tools.read.parameters);
  assert.deepEqual([...result.overridden], ["read"]);
  // `shell` was still absent, so it is injected alongside.
  assert.deepEqual([...result.injected], ["shell"]);
});

test("policy=rename moves the squatter aside and keeps the alias map", () => {
  const body: Record<string, unknown> = {
    tools: [
      {
        type: "function",
        function: { name: "read", description: "my own read", parameters: { type: "object" } },
      },
    ],
  };
  const result = applyFingerprint(body, { profile, policy: "rename" });

  const tools = body.tools as AnyTool[];
  const names = tools.map(nameOf);
  assert.ok(names.includes("read_client1"));
  assert.deepEqual([...result.renamed], [["read_client1", "read"]]);
  assert.equal(result.aliasMap.get("read_client1"), "read");

  // The client's definition survives under the alias; the official one owns `read`.
  const aliased = tools.find((tool) => nameOf(tool) === "read_client1");
  assert.ok(aliased);
  assert.equal(defOf(aliased).description, "my own read");
  const read = tools.find((tool) => nameOf(tool) === "read");
  assert.ok(read);
  assert.equal(defOf(read).description, profile.tools.read.description);
});

test("an already-fingerprinted body reports changed=false", () => {
  const body: Record<string, unknown> = { messages: [] };
  applyFingerprint(body, { profile });
  const second = applyFingerprint(body, { profile });
  assert.equal(second.changed, false);
  assert.deepEqual([...second.injected], []);
});

test("non-object bodies are returned untouched", () => {
  for (const body of [null, "text", [], 42]) {
    const result = applyFingerprint(body as never, { profile });
    assert.equal(result.changed, false);
  }
});

test("lane matching keys off provider id or model prefix only", () => {
  assert.equal(matchesLane({ provider: profile.match.providerIds[0] }, profile), true);
  assert.equal(matchesLane({ model: `${profile.match.modelPrefixes[0]}deepseek` }, profile), true);
  assert.equal(matchesLane({ provider: "openai", model: "gpt-4o" }, profile), false);
  assert.equal(matchesLane({}, profile), false);
});

test("session ids are minted, deterministic per signal and shape-valid", () => {
  const a = canonicalizeSession("omniroute-lane");
  const b = canonicalizeSession("omniroute-lane");
  const c = canonicalizeSession("another-lane");

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  assert.equal(isCanonicalSession(a), true);
  assert.equal(isCanonicalSession(c), true);

  // A hash-shaped (non-minted) id is exactly what the gate rejects.
  assert.equal(isCanonicalSession("ses_0123456789abAAAAAAAAAAAAAA"), false);
  assert.equal(isCanonicalSession("not-a-session"), false);
  assert.equal(isCanonicalSession(""), false);
});
