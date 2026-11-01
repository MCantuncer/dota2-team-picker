import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FALLBACKS, JUNGLE_HEROES, fallbackFor, fillFallback, type FallbackSlots, type Scaling, type Situation } from "../src/engine/fallbacks";
import type { Position, Snapshot } from "../src/engine/types";

/** Every slot filled, with the longest hero and item names in the data. */
const LONG: Required<FallbackSlots> = {
  hero: "Outworld Devourer",
  item: "Aghanim's Scepter",
  minute: 24,
  ourCarry: "Keeper of the Light",
  enemyCarry: "Outworld Devourer",
  enemyOfflaner: "Centaur Warrunner",
  ourKeyItem: "Aghanim's Scepter",
  enemyKeyItem: "Black King Bar",
  enemyMinute: 21,
};
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

describe("fallback templates", () => {
  it("only name slots that exist", () => {
    const known = new Set(Object.keys(LONG));
    for (const t of FALLBACKS) for (const [, slot] of t.text.matchAll(/\{(\w+)\}/g)) expect(known).toContain(slot);
  });

  it("stay short enough for two to fit a player's card, even with the longest names", () => {
    // The card has 110 words; two fallbacks may take at most half of it.
    for (const t of FALLBACKS) expect(words(fillFallback(t, LONG)!), t.text).toBeLessThanOrEqual(25);
  });

  it("never use the em dash", () => {
    for (const t of FALLBACKS) expect(t.text).not.toContain("\u2014");
  });

  it("name real heroes in the jungle list", () => {
    const data = JSON.parse(readFileSync("data/snapshot.json", "utf8")) as Snapshot;
    const names = new Set(Object.values(data.heroes).map((h) => h.name));
    for (const name of JUNGLE_HEROES) expect(names, name).toContain(name);
  });
});

describe("fallbackFor", () => {
  it("sends a carry who jungles well to the jungle, and one who doesn't to ask for help", () => {
    expect(fallbackFor("laneLost", 1, { hero: "Faceless Void", item: "Maelstrom" })).toBe(
      "Lane lost? Leave it at 5 to 6 min for the jungle and farm toward Maelstrom. Ask your supports to stack 2 camps.",
    );
    expect(fallbackFor("laneLost", 1, { hero: "Medusa", item: "Manta Style" })).toBe(
      "Lane lost? Ask for a lane swap or a rotation before 7 min, and skip trades until Manta Style.",
    );
  });

  it("falls back to a variant without the missing value", () => {
    expect(fallbackFor("keyItemLate", 1, { hero: "Juggernaut", item: "Black King Bar", minute: 24 })).toBe(
      "No Black King Bar by 24 min? Don't show on the map without it. Farm behind your towers.",
    );
    expect(fallbackFor("carryFree", 4, {})).toBe(
      "Their carry is farming free? Pressure that lane before 10 min. After that, take towers on the other side.",
    );
  });

  it("returns null when no line fits", () => {
    expect(fallbackFor("keyItemLate", 2, {})).toBeNull();
    expect(fallbackFor("carryFree", 1, LONG)).toBeNull();
  });

  it("picks the team line by who scales better", () => {
    const team = (situation: Situation, scaling: Scaling) => fallbackFor(situation, "team", { ourCarry: "Juggernaut", ourKeyItem: "Black King Bar" }, scaling);
    expect(team("behindAt20", "ours")).toBe("Behind at 20? Defend high ground until Juggernaut has Black King Bar. Catch their pos 4 and 5 out of position.");
    expect(team("behindAt20", "theirs")).toMatch(/^Behind at 20 against a late game team\?/);
    expect(team("aheadAt20", "theirs")).toBe("Ahead at 20? Take Roshan, then siege with the Aegis before their carry is ready.");
    expect(team("aheadAt20", "even")).toBe("Ahead at 20? Take Roshan and push one lane together with the Aegis.");
  });

  it("has a lane-lost line for every position", () => {
    for (const p of [1, 2, 3, 4, 5] as Position[]) expect(fallbackFor("laneLost", p, {}), `pos ${p}`).not.toBeNull();
  });
});
