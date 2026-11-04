// Host-binary requirements (`requires.binaries`) and the notice board behind them.
//
// The contract these pin down:
// - lookup is a PATH probe of a plain command name (never a path),
// - a missing binary never fails activation,
// - a dismissed notice stays dismissed across re-probes (every restart re-probes),
// - the notice disappears only when its cause does, so a later removal warns again.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const requirements = await import("../../src/lib/plugins/requirements.ts");
const notices = await import("../../src/lib/db/pluginNotices.ts");
const { safeValidateManifest } = await import("../../src/lib/plugins/manifest.ts");
const { getDbInstance } = await import("../../src/lib/db/core.ts");

const PLUGIN = "requirements-test";

function makeBinDir(binaries: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "omni-bin-"));
  for (const binary of binaries) {
    const file = join(dir, binary);
    writeFileSync(file, "#!/bin/sh\nexit 0\n");
    chmodSync(file, 0o755);
  }
  return dir;
}

function cleanup() {
  for (const notice of notices.listPluginNotices({ includeDismissed: true })) {
    if (notice.pluginName === PLUGIN) notices.dismissPluginNotice(notice.id);
  }
  notices.deletePluginNotices(PLUGIN);
}

describe("requires.binaries manifest contract", () => {
  const base = { name: "needs-dsh", version: "1.0.0" };

  it("defaults to an empty list so old manifests keep validating", () => {
    const result = safeValidateManifest(base);
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.deepEqual(result.data.requires.binaries, []);
  });

  it("accepts plain command names", () => {
    const result = safeValidateManifest({ ...base, requires: { binaries: ["dsh", "bun"] } });
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.deepEqual(result.data.requires.binaries, ["dsh", "bun"]);
  });

  it("rejects paths so a manifest cannot point the probe at a file", () => {
    for (const binary of ["/bin/sh", "../bin/sh", "bin/sh", "C:\\windows\\cmd"]) {
      const result = safeValidateManifest({ ...base, requires: { binaries: [binary] } });
      assert.equal(result.success, false, `expected rejection for ${binary}`);
    }
  });
});

describe("resolveHostBinary", () => {
  it("finds a command on the given PATH", () => {
    const dir = makeBinDir(["dsh-test-bin"]);
    try {
      assert.equal(
        requirements.resolveHostBinary("dsh-test-bin", { pathEnv: dir }),
        join(dir, "dsh-test-bin")
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for a command that is not installed", () => {
    const dir = makeBinDir([]);
    try {
      assert.equal(
        requirements.resolveHostBinary("definitely-not-installed", { pathEnv: dir }),
        null
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses paths so a manifest cannot probe the filesystem", () => {
    assert.equal(requirements.resolveHostBinary("/bin/sh"), null);
    assert.equal(requirements.resolveHostBinary("../bin/sh"), null);
    assert.equal(requirements.resolveHostBinary("bin/sh"), null);
  });

  it("returns null with an empty PATH instead of falling back to cwd", () => {
    assert.equal(requirements.resolveHostBinary("node", { pathEnv: "" }), null);
  });

  it("reports the subset that is missing, in declaration order", () => {
    const dir = makeBinDir(["present-a"]);
    try {
      const missing = requirements.findMissingHostBinaries(["present-a", "absent-b", "absent-c"], {
        pathEnv: dir,
      });
      assert.deepEqual(missing, ["absent-b", "absent-c"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("requirement notices", () => {
  beforeEach(() => {
    getDbInstance();
    cleanup();
  });

  it("raises one notice per missing binary and keeps looking after a re-probe", () => {
    const dir = makeBinDir([]);
    try {
      requirements.syncRequirementNotices(PLUGIN, ["absent-bin"], { pathEnv: dir });
      requirements.syncRequirementNotices(PLUGIN, ["absent-bin"], { pathEnv: dir });

      const open = notices.listPluginNotices().filter((n) => n.pluginName === PLUGIN);
      assert.equal(open.length, 1, "re-probing must not duplicate the notice");
      assert.equal(open[0].code, "missing_binary");
      assert.equal(open[0].subject, "absent-bin");
      assert.match(open[0].message, /absent-bin/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a dismissed notice dismissed across activations and restarts", () => {
    const dir = makeBinDir([]);
    try {
      requirements.syncRequirementNotices(PLUGIN, ["absent-bin"], { pathEnv: dir });
      const [first] = notices.listPluginNotices().filter((n) => n.pluginName === PLUGIN);
      assert.ok(first);
      assert.equal(notices.dismissPluginNotice(first.id), true);

      assert.equal(
        notices.listPluginNotices().filter((n) => n.pluginName === PLUGIN).length,
        0,
        "a dismissed notice is hidden from the banner"
      );

      // What a container restart does: reload the plugin, re-run the same probe.
      requirements.syncRequirementNotices(PLUGIN, ["absent-bin"], { pathEnv: dir });
      assert.equal(
        notices.listPluginNotices().filter((n) => n.pluginName === PLUGIN).length,
        0,
        "a restart must not resurrect a notice the operator closed"
      );

      // Dismissing twice is a no-op, not a second success.
      assert.equal(notices.dismissPluginNotice(first.id), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clears the notice when the binary appears, so a later removal warns again", () => {
    const emptyDir = makeBinDir([]);
    const fullDir = makeBinDir(["absent-bin"]);
    try {
      requirements.syncRequirementNotices(PLUGIN, ["absent-bin"], { pathEnv: emptyDir });
      assert.equal(notices.listPluginNotices().filter((n) => n.pluginName === PLUGIN).length, 1);

      requirements.syncRequirementNotices(PLUGIN, ["absent-bin"], { pathEnv: fullDir });
      assert.equal(
        notices.listPluginNotices({ includeDismissed: true }).filter((n) => n.pluginName === PLUGIN)
          .length,
        0,
        "installing the binary drops the row instead of leaving it dismissed forever"
      );

      const missingAgain = requirements.syncRequirementNotices(PLUGIN, ["absent-bin"], {
        pathEnv: emptyDir,
      });
      assert.deepEqual(missingAgain, ["absent-bin"]);
      assert.equal(notices.listPluginNotices().filter((n) => n.pluginName === PLUGIN).length, 1);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
      rmSync(fullDir, { recursive: true, force: true });
    }
  });

  it("does nothing when the plugin declares no binaries", () => {
    assert.deepEqual(requirements.syncRequirementNotices(PLUGIN, []), []);
    assert.equal(notices.listPluginNotices().filter((n) => n.pluginName === PLUGIN).length, 0);
  });

  it("drops a plugin's notices when it is deactivated", () => {
    const dir = makeBinDir([]);
    try {
      requirements.syncRequirementNotices(PLUGIN, ["absent-bin"], { pathEnv: dir });
      assert.ok(requirements.clearRequirementNotices(PLUGIN) >= 0);
      assert.equal(
        notices.listPluginNotices({ includeDismissed: true }).filter((n) => n.pluginName === PLUGIN)
          .length,
        0
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
