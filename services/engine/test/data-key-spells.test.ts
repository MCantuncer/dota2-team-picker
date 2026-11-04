import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KEY_SPELLS } from "../src/engine/data-key-spells";
import type { Snapshot } from "../src/engine/types";

const snapshot = JSON.parse(readFileSync(new URL("./fixtures/golden-snapshot.json", import.meta.url), "utf8")) as Snapshot;

describe("KEY_SPELLS", () => {
  it("has a spell for every hero", () => {
    const missing = Object.values(snapshot.heroes).filter((h) => !KEY_SPELLS[h.name]).map((h) => h.name);
    expect(missing).toEqual([]);
  });

  it("keeps each line short and free of dashes", () => {
    for (const [hero, s] of Object.entries(KEY_SPELLS)) {
      expect(s.line.length, hero).toBeLessThanOrEqual(56);
      expect(s.line, hero).not.toMatch(/[—–]/);
      expect(s.key, hero).toMatch(/^[a-z0-9_]+$/);
      expect(s.name, hero).not.toMatch(/_/);
    }
  });
});
