/**
 * `systemone` / `decisions` in the model endpoint taxonomy.
 *
 * They are decision-model surfaces (`/v1/systemone`, `/v1/decisions`), not media modalities:
 * they must be storable (`/api/provider-models` validates against the enum), selectable in the
 * row editor, and they must NOT make a text model look like an image/audio/embedding model to
 * `classifyModelSupportedEndpoints`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MODEL_SUPPORTED_ENDPOINT_VALUES,
  classifyModelSupportedEndpoints,
  isTrustedEndpointCapabilitySource,
  normalizeModelSupportedEndpoints,
} from "../../src/shared/constants/modelSupportedEndpoints.ts";

test("the enum accepts both decision endpoints", () => {
  assert.ok(MODEL_SUPPORTED_ENDPOINT_VALUES.includes("systemone"));
  assert.ok(MODEL_SUPPORTED_ENDPOINT_VALUES.includes("decisions"));
});

test("normalization keeps them, deduped and ordered", () => {
  assert.deepEqual(normalizeModelSupportedEndpoints(["systemone", "decisions", "systemone"]), [
    "systemone",
    "decisions",
  ]);
  assert.deepEqual(normalizeModelSupportedEndpoints(["decisions", "chat"]), ["decisions", "chat"]);
});

test("a decision-only model is text, not a media modality", () => {
  assert.deepEqual(classifyModelSupportedEndpoints(["systemone"]), {});
  assert.deepEqual(classifyModelSupportedEndpoints(["decisions"]), {});
  assert.deepEqual(classifyModelSupportedEndpoints(["decisions", "videos"]), {});
  // A media-only model still classifies as media.
  assert.deepEqual(classifyModelSupportedEndpoints(["videos"]), { type: "video" });
});

test("an operator-set decision tag is trusted, so the gate can act on it", () => {
  assert.equal(isTrustedEndpointCapabilitySource("operator"), true);
});

test("the row editor offers both checkboxes next to chat/responses", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/app/(dashboard)/dashboard/providers/[id]/components/ModelEndpointTagsEditor.tsx"
    ),
    "utf8"
  );
  const optionsBlock = source.slice(source.indexOf("const OPTIONS"), source.indexOf("];"));
  const order = ["chat", "responses", "systemone", "decisions"].map((endpoint) =>
    optionsBlock.indexOf(`"${endpoint}"`)
  );
  assert.ok(
    order.every((index) => index >= 0),
    "all four endpoints must be listed"
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    "chat, responses, systemone, decisions must appear in that order"
  );
});

test("the dispatch guard maps both endpoints to their real routes", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/providerModels/modelEndpointGuard.ts"),
    "utf8"
  );
  assert.match(source, /systemone: "\/v1\/systemone"/);
  assert.match(source, /decisions: "\/v1\/decisions"/);
  assert.match(source, /\| "systemone"/);
  assert.match(source, /\| "decisions"/);
});
