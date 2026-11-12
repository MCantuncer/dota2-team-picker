import { describe, expect, it } from "vitest";
import type { MatchupGame } from "../src/engine/matchup-talents";
import { skillPlan, type SkillPlan } from "../src/engine/skill-plan";
import type { HeroAbilities, SkillBuildSlice, Snapshot } from "../src/engine/types";

// Sven: Storm Hammer (1), Great Cleave (2), Warcry (3), God's Strength (4); talents 10 to 17.
const sven: HeroAbilities = {
  abilities: [
    { id: 1, key: "sven_storm_bolt", name: "Storm Hammer", slot: 1, maxLevel: 4, ultimate: false },
    { id: 2, key: "sven_great_cleave", name: "Great Cleave", slot: 2, maxLevel: 4, ultimate: false },
    { id: 3, key: "sven_warcry", name: "Warcry", slot: 3, maxLevel: 4, ultimate: false },
    { id: 4, key: "sven_gods_strength", name: "God's Strength", slot: 6, maxLevel: 3, ultimate: true },
  ],
  talents: [
    [
      { id: 10, name: "+2 Mana Regen" },
      { id: 11, name: "+15 Damage" },
    ],
    [
      { id: 12, name: "+20% Cleave" },
      { id: 13, name: "+8 Strength" },
    ],
  ],
};
const even = [
  { id: 10, games: 1000, wins: 500 },
  { id: 11, games: 1000, wins: 500 },
];
const slice = (over: Partial<SkillBuildSlice> = {}): SkillBuildSlice => ({
  at: "2026-11-01T00:00:00Z",
  gameVersionId: 184,
  matches: 120,
  build: { levels: [1, 2, 2, 1, 2, 4, 2, 1, 1, 10], groupMatches: 78, share: 0.65, exactMatches: 40 },
  talents: [
    { tier: 0, id: 10, share: 0.55, games: 110, level: 10, sides: even },
    { tier: 1, id: 13, share: 0.8, games: 60, level: 15 },
  ],
  ...over,
});
const data = (s = slice()): Pick<Snapshot, "heroAbilities" | "skillBuilds"> => ({
  heroAbilities: { 18: sven },
  skillBuilds: { 18: { 3: s } },
});
const ENEMIES = ["Lion", "Lina", "Zeus", "Pudge", "Tidehunter"];

let next = 1;
const games = (n: number, id: number, won: boolean): MatchupGame[] =>
  Array.from({ length: n }, () => {
    const match = next++;
    return { match, account: match, won, level: 16, version: 184, points: [1, 2, id] };
  });
// +15 Damage clearly better at level 10 against these enemies.
const clear = () => [...games(60, 11, true), ...games(15, 11, false), ...games(15, 10, true), ...games(40, 10, false)];

/** The plan, failing the test when there is none. */
function plan(...args: Parameters<typeof skillPlan>): SkillPlan {
  const p = skillPlan(...args);
  if (!p) throw new Error("Expected a skill plan");
  return p;
}
const tiers = (p: SkillPlan) => p.talents.map((t) => [t.pick, t.result]);
// +15 Damage a bit better at level 10, not sure enough to switch.
const leaning = () => [...games(29, 11, true), ...games(12, 11, false), ...games(6, 10, true), ...games(11, 10, false)];

describe("skillPlan", () => {
  it("is null only when the snapshot has no abilities for the hero", () => {
    expect(skillPlan({ skillBuilds: data().skillBuilds }, 18, 3, ENEMIES, undefined)).toBeNull();
  });

  it("still shows the whole tree when the weekly builds don't have the position", () => {
    const p = plan(data(), 18, 1, ENEMIES, undefined);
    expect(p.levels).toBeNull();
    expect(p.agreement).toBeUndefined();
    expect(p.buildReason).toBe("No high-rank skill builds for this hero in this position yet.");
    expect(p.talents.map((t) => [t.level, t.pick, t.result])).toEqual([
      [10, null, "no-data"],
      [15, null, "no-data"],
    ]);
  });

  it("shows the usual talents as general while the matchup games load", () => {
    const p = plan(data(), 18, 3, ENEMIES, undefined);
    expect(p.live).toBe("loading");
    expect(p.levels).toEqual([1, 2, 2, 1, 2, 4, 2, 1, 1, 10]);
    // The order's agreement as numbers, the same ones buildReason says.
    expect(p.agreement).toEqual({ wins: 78, of: 120, share: 0.65 });
    expect(p.names[4]).toBe("God's Strength");
    expect(tiers(p)).toEqual([
      [10, "general"],
      [13, "general"],
    ]);
    expect(p.note).toBeUndefined();
    // The usual talent's share as numbers, for the tree's share bars.
    expect(p.talents.map((t) => [t.usualShare, t.usualGames])).toEqual([
      [0.55, 110],
      [0.8, 60],
    ]);
  });

  it("decides each tier from the matchup games once they are in", () => {
    const p = plan(data(), 18, 3, ENEMIES, clear());
    expect(p.live).toBe("ready");
    expect(p.talents[0]).toMatchObject({ pick: 11, usual: 10, result: "recommended" });
    expect(p.talents[0]?.options.map((o) => o.name)).toEqual(["+2 Mana Regen", "+15 Damage"]);
    // No game took a level 15 talent, so it keeps the usual one as a general line.
    expect(p.talents[1]).toMatchObject({ pick: 13, result: "general" });
    expect(p.note).toBeDefined();
  });

  it("keeps the usual talent when the games only lean the other way", () => {
    expect(plan(data(), 18, 3, ENEMIES, leaning()).talents[0]).toMatchObject({ pick: 10, result: "leaning" });
  });

  it("keeps the usual talents when the lookup failed, and when it found no games", () => {
    const failed = plan(data(), 18, 3, ENEMIES, null);
    expect(failed.live).toBe("unavailable");
    expect(failed.talents.every((t) => t.result === "general" && t.pick === t.usual)).toBe(true);
    const none = plan(data(), 18, 3, ENEMIES, []);
    expect(none.live).toBe("ready");
    expect(tiers(none)).toEqual(tiers(failed));
    expect(none.note).toBeUndefined();
  });

  it("keeps the usual talents for a signed-out viewer", () => {
    const p = plan(data(), 18, 3, ENEMIES, "sign-in");
    expect(p.live).toBe("sign-in");
    expect(tiers(p)).toEqual([
      [10, "general"],
      [13, "general"],
    ]);
  });

  it("shows every tier of the tree, also one with no talent picks", () => {
    const three = {
      ...sven,
      talents: [
        ...sven.talents,
        [
          { id: 14, name: "+1 Storm Hammer Charge" },
          { id: 15, name: "+15% Lifesteal" },
        ],
      ],
    };
    const p = plan({ ...data(), heroAbilities: { 18: three } }, 18, 3, ENEMIES, clear());
    expect(p.talents).toHaveLength(3);
    expect(p.talents[2]).toMatchObject({ level: 20, pick: null, result: "no-data" });
  });

  it("leaves out a tier whose pair is incomplete", () => {
    const odd = { ...sven, talents: [sven.talents[0] ?? [], [{ id: 12, name: "+20% Cleave" }]] };
    expect(plan({ ...data(), heroAbilities: { 18: odd } }, 18, 3, ENEMIES, undefined).talents).toHaveLength(1);
  });

  it("shows no pick when a patch changed the weekly talent", () => {
    const old = slice({ talents: [{ tier: 0, id: 99, share: 0.6, games: 100, level: 10 }] });
    expect(plan(data(old), 18, 3, ENEMIES, clear()).talents[0]).toMatchObject({ pick: null, result: "no-data" });
  });

  it("says last patch when the slice is older than the others", () => {
    const d = data(slice({ gameVersionId: 183 }));
    const builds = { ...d.skillBuilds, 1: { 1: slice() } };
    expect(plan({ ...d, skillBuilds: builds }, 18, 3, ENEMIES, undefined).buildReason).toContain(
      "high-rank wins last patch",
    );
  });

  it("says why there is no order", () => {
    const few = plan(data(slice({ build: undefined, none: "few-matches", matches: 12 })), 18, 3, ENEMIES, null);
    expect(few.levels).toBeNull();
    expect(few.buildReason).toContain("Only 12 high-rank wins");
  });

  it("writes every line from the numbers (golden examples)", async () => {
    const lines = [
      ["loading", plan(data(), 18, 3, ENEMIES, undefined)],
      ["lookup failed", plan(data(), 18, 3, ENEMIES, null)],
      ["lookup found no games", plan(data(), 18, 3, ENEMIES, [])],
      ["signed out", plan(data(), 18, 3, ENEMIES, "sign-in")],
      ["ready", plan(data(), 18, 3, ENEMIES, clear())],
      ["leaning", plan(data(), 18, 3, ENEMIES, leaning())],
      ["no agreement", plan(data(slice({ build: undefined, none: "no-agreement" })), 18, 3, ENEMIES, undefined)],
      ["no weekly build", plan(data(), 18, 1, ENEMIES, undefined)],
    ] as const;
    const text = lines
      .map(([label, p]) =>
        [
          `${label}:`,
          `order: ${p.buildReason}`,
          ...p.talents.map((t) => `level ${t.level}: ${t.reason}${t.odds ? ` [${t.odds}]` : ""}`),
          ...(p.note ? [`note: ${p.note}`] : []),
        ].join("\n"),
      )
      .join("\n\n");
    await expect(text + "\n").toMatchFileSnapshot("./golden/skill-plan-lines.txt");
  });
});
