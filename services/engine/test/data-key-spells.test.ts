import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KEY_SPELLS, PIERCES_BKB } from "../src/engine/data-key-spells";
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

  it("marks only key spells as going through Black King Bar, never as answered by it", () => {
    const keys = new Map(Object.values(KEY_SPELLS).map((s) => [s.key, s]));
    for (const key of Object.keys(PIERCES_BKB)) {
      expect(keys.has(key), key).toBe(true);
      // "magic" means Black King Bar answers it, which a spell that goes through it never is.
      expect(keys.get(key)?.kind, key).not.toBe("magic");
    }
  });
});

describe("hidden rules from Valve's notes", () => {
  it("lets Black King Bar answer Global Silence, which debuff immunity removes", () => {
    expect(PIERCES_BKB.silencer_global_silence).toBeUndefined();
    expect(KEY_SPELLS.Silencer?.kind).toBe("magic");
  });

  it("names Culling Blade as the kill through Shallow Grave and Battle Trance", () => {
    expect(KEY_SPELLS.Dazzle?.line).toContain("Culling Blade");
    expect(KEY_SPELLS["Troll Warlord"]?.line).toContain("Culling Blade");
  });
});
