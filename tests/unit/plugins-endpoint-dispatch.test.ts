import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { toManifestPath, isEndpointPathAllowed } =
  await import("../../src/lib/plugins/endpointPath.ts");

describe("plugin endpoint path normalisation", () => {
  it("maps the /api mount onto the manifest form", () => {
    assert.equal(toManifestPath("/api/v1/decisions"), "/v1/decisions");
    assert.equal(toManifestPath("/api/v1/model-health"), "/v1/model-health");
  });

  it("leaves the /v1 mount untouched", () => {
    assert.equal(toManifestPath("/v1/decisions"), "/v1/decisions");
  });

  it("does not touch unrelated paths", () => {
    assert.equal(toManifestPath("/dashboard/providers"), "/dashboard/providers");
  });
});

describe("plugin endpoint path allowlist", () => {
  it("allows only /v1 and /api/v1 prefixes", () => {
    assert.equal(isEndpointPathAllowed("/v1/decisions"), true);
    assert.equal(isEndpointPathAllowed("/api/v1/decisions"), true);
  });

  it("refuses dashboard and settings surfaces", () => {
    assert.equal(isEndpointPathAllowed("/dashboard/providers"), false);
    assert.equal(isEndpointPathAllowed("/api/settings"), false);
    assert.equal(isEndpointPathAllowed("/api/plugins"), false);
  });
});
