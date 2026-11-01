/**
 * TypeSafe decision endpoints (`/v1/systemone`, `/v1/decisions`).
 *
 * Covers the pure half of the pipeline — model normalisation and body pass-through — plus a
 * source-level check that both route files actually wire the shared handler and CORS preflight
 * (a route file that forgets `export const POST` 404s in production but type-checks fine).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TYPESAFE_DECISIONS_DEFAULT_MODEL,
  TYPESAFE_DECISIONS_MODELS,
  TYPESAFE_DECISIONS_PATH,
  TYPESAFE_SYSTEMONE_DEFAULT_MODEL,
  TYPESAFE_SYSTEMONE_MODELS,
  TYPESAFE_SYSTEMONE_PATH,
  buildDecisionRequestBody,
  resolveDecisionModel,
  typesafeEndpointDefaultModel,
  typesafeEndpointModels,
  typesafeEndpointPath,
} from "../../open-sse/services/typesafe/decisions.ts";

const REPO_ROOT = process.cwd();

test("systemone accepts jev and clef, decisions accepts gpt", () => {
  assert.deepEqual([...TYPESAFE_SYSTEMONE_MODELS], ["jev", "jev-latest", "clef", "clef-latest"]);
  assert.deepEqual([...TYPESAFE_DECISIONS_MODELS], ["gpt", "gpt-latest"]);
  assert.equal(TYPESAFE_SYSTEMONE_PATH, "/v1/systemone");
  assert.equal(TYPESAFE_DECISIONS_PATH, "/v1/decisions");
  assert.equal(typesafeEndpointPath("systemone"), "/v1/systemone");
  assert.equal(typesafeEndpointPath("decisions"), "/v1/decisions");
  assert.deepEqual([...typesafeEndpointModels("decisions")], ["gpt", "gpt-latest"]);
  assert.equal(typesafeEndpointDefaultModel("systemone"), TYPESAFE_SYSTEMONE_DEFAULT_MODEL);
  assert.equal(typesafeEndpointDefaultModel("decisions"), TYPESAFE_DECISIONS_DEFAULT_MODEL);
});

test("an absent or blank model falls back to the endpoint default", () => {
  assert.deepEqual(resolveDecisionModel("systemone", undefined), {
    ok: true,
    model: "jev-latest",
  });
  assert.deepEqual(resolveDecisionModel("systemone", "   "), { ok: true, model: "jev-latest" });
  assert.deepEqual(resolveDecisionModel("decisions", null), { ok: true, model: "gpt-latest" });
});

test("accepted names are forwarded verbatim, lower-cased", () => {
  assert.deepEqual(resolveDecisionModel("systemone", "jev"), { ok: true, model: "jev" });
  assert.deepEqual(resolveDecisionModel("systemone", "CLEF"), { ok: true, model: "clef" });
  assert.deepEqual(resolveDecisionModel("decisions", "gpt"), { ok: true, model: "gpt" });
  assert.deepEqual(resolveDecisionModel("systemone", " clef-latest "), {
    ok: true,
    model: "clef-latest",
  });
});

test("a model from the other endpoint is rejected with the accepted list", () => {
  const decisionsRejectsClef = resolveDecisionModel("decisions", "clef");
  assert.equal(decisionsRejectsClef.ok, false);
  if (decisionsRejectsClef.ok) return;
  assert.deepEqual([...decisionsRejectsClef.allowed], ["gpt", "gpt-latest"]);
  assert.match(decisionsRejectsClef.error, /Unsupported model for \/v1\/decisions: clef/);

  const systemoneRejectsGpt = resolveDecisionModel("systemone", "gpt");
  assert.equal(systemoneRejectsGpt.ok, false);
  if (systemoneRejectsGpt.ok) return;
  assert.match(systemoneRejectsGpt.error, /Allowed: jev, jev-latest, clef, clef-latest\./);
});

test("non-string models are rejected instead of coerced", () => {
  for (const value of [42, {}, [], true]) {
    const result = resolveDecisionModel("systemone", value);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.match(result.error, /model must be a string/);
  }
});

test("the forwarded body keeps every field and only rewrites model", () => {
  const body = {
    model: "jev",
    state: "I was charged twice this month.",
    questions: { billing: { type: "noul", instructions: "Is this about billing?" } },
    assets: { "<IMG_1>": { type: "image", part: "image_1" } },
  };
  const forwarded = buildDecisionRequestBody(body, "jev-latest");

  assert.equal(forwarded.model, "jev-latest");
  assert.deepEqual(forwarded.questions, body.questions);
  assert.deepEqual(forwarded.assets, body.assets);
  assert.equal(forwarded.state, body.state);
  // The caller's object is not mutated.
  assert.equal(body.model, "jev");
});

test("both route files export POST and OPTIONS through the shared pipeline", () => {
  for (const [dir, endpoint] of [
    ["systemone", "systemone"],
    ["decisions", "decisions"],
  ] as const) {
    const source = readFileSync(
      join(REPO_ROOT, "src", "app", "api", "v1", dir, "route.ts"),
      "utf8"
    );
    assert.match(source, /export const POST = makeTypesafeDecisionPost\("([a-z]+)"\)/);
    assert.match(source, new RegExp(`makeTypesafeDecisionPost\\("${endpoint}"\\)`));
    assert.match(source, /export const OPTIONS = typesafeDecisionOptions;/);
  }
});
