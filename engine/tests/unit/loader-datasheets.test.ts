import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import yaml from "js-yaml";

const TMP_DIR = join(import.meta.dirname, "../tmp-datasheet-test");

async function writePack(opts: { datasheets?: unknown; units: Record<string, unknown> }) {
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(join(TMP_DIR, "manifest.yaml"), yaml.dump({
    id: "ds-test", name: "Datasheet Test", version: "0.1.0", engine_version: "^0.2.0", dependencies: [],
  }));
  await writeFile(join(TMP_DIR, "timeline.yaml"), yaml.dump({
    timeline: [{ event: "StartOfGame" }], subSequences: {},
  }));
  await writeFile(join(TMP_DIR, "glossary.yaml"), yaml.dump({
    keywords: ["INFANTRY"], selectors: {},
  }));
  await writeFile(join(TMP_DIR, "rules.json"), "[]");
  await writeFile(join(TMP_DIR, "initial_state.json"), JSON.stringify({ units: opts.units }));
  if (opts.datasheets) {
    await writeFile(join(TMP_DIR, "datasheets.yaml"), yaml.dump(opts.datasheets));
  }
}

async function cleanup() {
  await rm(TMP_DIR, { recursive: true, force: true });
}

describe("loadPack with datasheets", () => {
  it("merges datasheet into unit state", async () => {
    await writePack({
      datasheets: {
        datasheets: {
          marine: {
            name: "Space Marine",
            keywords: ["INFANTRY"],
            stats: { M: 6, T: 4, Sv: 3, W: 2, Ld: 6, OC: 2 },
          },
        },
      },
      units: {
        u1: { id: "u1", owner: "A", datasheet: "marine", models: { total: 5, remaining: 5 }, statuses: {} },
      },
    });
    const result = await loadPack(TMP_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const u1 = (result.pack.initialState as any).units.u1;
    expect(u1.name).toBe("Space Marine");
    expect(u1.stats.Ld).toBe(6);
    expect(u1.datasheet).toBeUndefined();
    await cleanup();
  });

  it("loads successfully without datasheets.yaml", async () => {
    await writePack({
      units: {
        u1: { id: "u1", owner: "A", name: "Manual", models: { total: 1, remaining: 1 }, statuses: {} },
      },
    });
    const result = await loadPack(TMP_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.pack.initialState as any).units.u1.name).toBe("Manual");
    await cleanup();
  });

  it("returns error for missing datasheet reference", async () => {
    await writePack({
      datasheets: { datasheets: {} },
      units: {
        u1: { id: "u1", owner: "A", datasheet: "ghost", models: { total: 1, remaining: 1 }, statuses: {} },
      },
    });
    const result = await loadPack(TMP_DIR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "DATASHEET_NOT_FOUND")).toBe(true);
    await cleanup();
  });
});
