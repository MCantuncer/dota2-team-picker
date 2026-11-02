import { describe, expect, it } from "vitest";
import { gamePlan } from "../src/engine/game-plan";
import { Engine } from "../src/engine/score";
import type { HeroInfo, Snapshot } from "../src/engine/types";

const hero = (id: number, name: string, roles: string[]): HeroInfo => ({ id, name, roles, attackType: "Melee", primaryAttr: "str" });

/**
 * Ours: Medusa 1, Magnus 2, Sven 3, Lion 4, Crystal Maiden 5 (Magnus + Sven is a known combo).
 * Theirs: Anti-Mage (hard counters Medusa), Spectre, Terrorblade (late game), Witch Doctor, Lich.
 * Each hero's lane data puts it in one position, so the enemy guess is fixed.
 */
function data(): Snapshot {
  const heroes: [HeroInfo, "1" | "2" | "3"][] = [
    [hero(94, "Medusa", ["Carry"]), "1"],
    [hero(97, "Magnus", ["Initiator", "Disabler"]), "2"],
    [hero(18, "Sven", ["Carry", "Disabler", "Initiator"]), "3"],
    [hero(26, "Lion", ["Support", "Disabler", "Nuker"]), "3"],
    [hero(5, "Crystal Maiden", ["Support", "Disabler", "Nuker"]), "1"],
    [hero(1, "Anti-Mage", ["Carry", "Escape"]), "1"],
    [hero(67, "Spectre", ["Carry", "Durable"]), "2"],
    [hero(109, "Terrorblade", ["Carry", "Pusher"]), "3"],
    [hero(30, "Witch Doctor", ["Support", "Disabler", "Nuker"]), "3"],
    [hero(31, "Lich", ["Support", "Nuker"]), "1"],
  ];
  const even = { picks: Array(8).fill(1000), wins: Array(8).fill(500) };
  const positions: Record<string, number[]> = {
    94: [1000, 0, 0, 0, 0], 97: [0, 1000, 0, 0, 0], 18: [0, 0, 1000, 0, 0], 26: [0, 0, 0, 1000, 0], 5: [0, 0, 0, 0, 1000],
    1: [1000, 0, 0, 0, 0], 67: [0, 1000, 0, 0, 0], 109: [0, 0, 1000, 0, 0], 30: [0, 0, 0, 1000, 0], 31: [0, 0, 0, 0, 1000],
  };
  return {
    generatedAt: "2026-10-26T00:00:00Z",
    heroes: Object.fromEntries(heroes.map(([h]) => [h.id, h])),
    bracketStats: Object.fromEntries(heroes.map(([h]) => [h.id, even])),
    // Our safe lane (Medusa, CM) beats their off lane (Terrorblade, Witch Doctor) clearly.
    matchups: {
      94: { 109: { games: 2000, wins: 1300 } },
      109: { 94: { games: 2000, wins: 700 } },
    },
    synergy: {},
    laneRoles: Object.fromEntries(heroes.map(([h, lane]) => [h.id, { [lane]: 100 }])),
    positions,
  };
}

const ours = [
  { heroId: 94, position: 1 as const },
  { heroId: 97, position: 2 as const },
  { heroId: 18, position: 3 as const },
  { heroId: 26, position: 4 as const },
  { heroId: 5, position: 5 as const },
];
const theirs = [1, 67, 109, 30, 31];

describe("gamePlan", () => {
  it("needs all ten heroes", () => {
    expect(() => gamePlan(new Engine(data()), { ours: ours.slice(0, 4), theirs })).toThrow("all ten heroes");
  });

  it("guesses the lanes and calls a won lane", () => {
    const plan = gamePlan(new Engine(data()), { ours, theirs });
    const safe = plan.lanes.find((l) => l.name === "Safe lane")!;
    expect(safe.ours).toEqual([94, 5]);
    expect(safe.theirs).toEqual([109, 30]);
    expect(safe.verdict).toBe("win");
    expect(plan.lanes.find((l) => l.name === "Mid")!.verdict).toBe("even");
    expect(plan.roadmap[0]!.text).toContain("Press your edge in the safe lane");
  });

  it("names combos, hard counters and when to fight a late-game team", () => {
    const plan = gamePlan(new Engine(data()), { ours, theirs });
    expect(plan.ourCombos).toEqual(["Magnus + Sven: Reverse Polarity into Sven's God's Strength cleave"]);
    expect(plan.fears).toContain("Medusa is hard countered by Anti-Mage: play carefully around them");
    expect(plan.theirStyle?.key).toBe("lategame");
    expect(plan.winCondition).toContain("take fights and towers before 30 minutes");
    expect(plan.roadmap[1]!.text).toContain("This is your window");
    // The same window shapes our carry's job: no "carry the late game" against a late-game team.
    expect(plan.players[0]!.job).toMatch(/^Farm fast, then join every push/);
  });

  it("warns about their carry as a danger hero", () => {
    const plan = gamePlan(new Engine(data()), { ours, theirs });
    expect(plan.danger).toEqual(["Anti-Mage: farms fast. Take fights early."]);
  });

  it("names no enemy carry when their pos 1 is a support filling the slot", () => {
    const d = data();
    // Anti-Mage becomes a support: pos 1 is still filled by him, but he isn't a carry.
    d.positions![1] = [200, 0, 0, 400, 400];
    const plan = gamePlan(new Engine(d), { ours, theirs });
    expect(plan.danger.join(" ")).not.toContain("Anti-Mage");
    expect(plan.players.flatMap((p) => p.fallbacks).join(" ")).not.toContain("Anti-Mage");
    expect(JSON.stringify(plan.story)).not.toContain("Anti-Mage");
  });

  it("gives an enemy's item minute only when it comes from their position", () => {
    const d = data();
    d.items = { 145: { key: "bfury", name: "Battle Fury", cost: 4100, img: "", components: [] } };
    // OpenDota's build mixes every position the hero is played in.
    d.itemBuilds = { 1: { start: {}, early: {}, mid: { 145: 90 }, late: {} } };
    const line = () => gamePlan(new Engine(d), { ours, theirs }).danger[0];
    expect(line()).toMatch(/^Anti-Mage: Battle Fury around \d+ min/);
    // Played as a pos 1 only half the time: his usual build isn't a pos 1 build.
    d.positions![1] = [500, 0, 0, 500, 0];
    expect(line()).toBe("Anti-Mage: farms fast. Take fights early.");
  });

  it("gives every player a job, and no build without item data", () => {
    const plan = gamePlan(new Engine(data()), { ours, theirs });
    expect(plan.players.map((p) => p.position)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.players[2]!.job).toContain("start the team's fights as Sven");
    expect(plan.players[1]!.job).toContain("Set up Reverse Polarity into Sven's God's Strength cleave with Sven");
    expect(plan.players.every((p) => p.build === null)).toBe(true);
  });

  it("adds fallbacks for a hard lane and for the team, shaped by who scales better", () => {
    const hard = data();
    // Their safe lane (Anti-Mage) crushes our offlaner Sven, so the off lane is hard.
    hard.matchups[18] = { 1: { games: 2000, wins: 600 } };
    hard.matchups[1] = { 18: { games: 2000, wins: 1400 } };
    const plan = gamePlan(new Engine(hard), { ours, theirs });
    expect(plan.lanes.find((l) => l.name === "Off lane")!.verdict).toBe("hard");
    const lines = (pos: number) => plan.players.find((p) => p.position === pos)!.fallbacks;
    expect(lines(3)).toEqual(["Lane lost? Stop contesting Anti-Mage. Farm the jungle and stay alive for the first fights."]);
    expect(lines(4)).toEqual([
      "Lane lost? Leave it after 4 min. Gank mid, or stack camps for Medusa.",
      "Anti-Mage is farming free? Pressure that lane before 10 min. After that, take towers on the other side.",
    ]);
    expect(lines(5)[0]).toBe("Anti-Mage is farming free? Ward their jungle so your cores can catch them, and buy a Smoke before your own items.");
    // The won safe lane and the even mid get no lines, and no build means no item line.
    expect(lines(1)).toEqual([]);
    expect(lines(2)).toEqual([]);
    // The story says when to fight: before their late-game carries are ready.
    expect(plan.story.headline).toBe("Win before 30 minutes: their Anti-Mage outscales us.");
    expect(plan.story.chapters[0]!.text).toBe("Press the safe lane. The off lane is hard against Anti-Mage and Lich: Magnus brings the 6 min rune there.");
    // Their late-game style means they scale better.
    expect(plan.teamFallbacks).toEqual([
      "Behind at 20? Don't wait for the late game. Smoke together and catch one hero before each objective.",
      "Ahead at 20? Take Roshan, then siege with the Aegis before Anti-Mage is ready.",
    ]);
  });
});
