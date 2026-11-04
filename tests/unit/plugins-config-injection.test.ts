import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { getPluginConfig, getPluginGateway } = await import("../../src/lib/plugins/sdk.ts");

const ENV_KEY = "OMNIROUTE_PLUGIN_CONFIG";
const GATEWAY_ORIGIN = "OMNIROUTE_PLUGIN_GATEWAY_ORIGIN";
const GATEWAY_KEY = "OMNIROUTE_PLUGIN_GATEWAY_KEY";
let previous: string | undefined;
let previousOrigin: string | undefined;
let previousKey: string | undefined;

describe("plugin config injection", () => {
  beforeEach(() => {
    previous = process.env[ENV_KEY];
    previousOrigin = process.env[GATEWAY_ORIGIN];
    previousKey = process.env[GATEWAY_KEY];
    delete process.env[GATEWAY_ORIGIN];
    delete process.env[GATEWAY_KEY];
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previous;
    if (previousOrigin === undefined) delete process.env[GATEWAY_ORIGIN];
    else process.env[GATEWAY_ORIGIN] = previousOrigin;
    if (previousKey === undefined) delete process.env[GATEWAY_KEY];
    else process.env[GATEWAY_KEY] = previousKey;
  });

  it("reports no gateway when the network permission was not granted", () => {
    assert.equal(getPluginGateway(), null);
  });

  it("returns the injected gateway origin and self-loop key", () => {
    process.env[GATEWAY_ORIGIN] = "http://127.0.0.1:20128";
    process.env[GATEWAY_KEY] = "self-loop-secret";
    assert.deepEqual(getPluginGateway(), {
      origin: "http://127.0.0.1:20128",
      apiKey: "self-loop-secret",
    });
  });

  it("treats a half-injected gateway as unavailable rather than empty credentials", () => {
    process.env[GATEWAY_ORIGIN] = "http://127.0.0.1:20128";
    assert.equal(getPluginGateway(), null);
  });

  it("returns an empty object when the host injected no config", () => {
    delete process.env[ENV_KEY];
    assert.deepEqual(getPluginConfig(), {});
  });

  it("parses the JSON the host writes into the environment", () => {
    process.env[ENV_KEY] = JSON.stringify({ apiKey: "k", retries: 2 });
    assert.deepEqual(getPluginConfig(), { apiKey: "k", retries: 2 });
  });

  it("degrades to an empty object on malformed JSON instead of throwing", () => {
    process.env[ENV_KEY] = "{not json";
    assert.deepEqual(getPluginConfig(), {});
  });

  it("rejects non-object payloads", () => {
    process.env[ENV_KEY] = "[1,2,3]";
    assert.deepEqual(getPluginConfig(), {});
  });
});
