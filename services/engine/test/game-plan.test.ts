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

  it("calls the lane from real lane results when the snapshot has them, naming the pair", () => {
    const d = data();
    // Medusa wins the game against Terrorblade but loses the lane to him, the worst of the four pairs.
    d.laneOutcomes = {
      "0": {
        94: { 109: [5000, 1500, 1250, 2250], 30: [3000, 900, 1000, 1100] },
        5: { 109: [4000, 1100, 1400, 1500], 30: [4000, 1300, 1400, 1300] },
      },
    };
    const safe = gamePlan(new Engine(d), { ours, theirs }).lanes.find((l) => l.name === "Safe lane")!;
    expect(safe.verdict).toBe("hard");
    expect(safe.laneNet).toBeLessThan(-5);
    expect(safe.text).toContain("Medusa wins 30% and loses 45% of 5,000 lanes against Terrorblade.");
  });

  it("names combos and hard counters, and claims no window from the style lists", () => {
    const plan = gamePlan(new Engine(data()), { ours, theirs });
    expect(plan.ourCombos).toEqual(["Magnus + Sven: Reverse Polarity into Sven's God's Strength cleave"]);
    expect(plan.fears).toContain("Medusa is hard countered by Anti-Mage: play carefully around them");
    expect(plan.theirStyle?.key).toBe("lategame");
    // Style labels barely change who wins short or long games (richer Game Story research), so no minute
    // windows come from them.
    expect(plan.winCondition).not.toContain("before 30 minutes");
    expect(plan.roadmap[1]!.text).not.toContain("This is your window");
    expect(plan.players[0]!.job).not.toMatch(/^Farm fast, then join every push/);
  });

  it("leaves their carry out of the danger heroes without a minute to race", () => {
    expect(gamePlan(new Engine(data()), { ours, theirs }).danger).toEqual([]);
  });

  it("names no enemy carry when their pos 1 is a support filling the slot", () => {
    const d = data();
    // Anti-Mage becomes a support: pos 1 is still filled by him, but he is rarely played there.
    d.positions![1] = [100, 0, 0, 450, 450];
    d.matchups[18] = { 1: { games: 2000, wins: 600 } };
    d.matchups[1] = { 18: { games: 2000, wins: 1400 } };
    const plan = gamePlan(new Engine(d), { ours, theirs });
    expect(plan.danger.join(" ")).not.toContain("Anti-Mage");
    expect(plan.players.flatMap((p) => p.fallbacks).join(" ")).not.toContain("Anti-Mage");
  });

  it("names a flex carry who is clearly their pos 1, like carry Vengeful Spirit", () => {
    const d = data();
    // Pos 1 in 1 game of 5, and nobody else in their lineup plays it.
    d.positions![1] = [200, 0, 0, 400, 400];
    // With no sure minute to race, not a danger hero.
    expect(gamePlan(new Engine(d), { ours, theirs }).danger).toEqual([]);
    // Their safe lane beats our off lane, so our supports get a line naming him as their carry.
    d.matchups[18] = { 1: { games: 2000, wins: 600 } };
    d.matchups[1] = { 18: { games: 2000, wins: 1400 } };
    const plan = gamePlan(new Engine(d), { ours, theirs });
    expect(plan.players.flatMap((p) => p.fallbacks).join(" ")).toContain("Anti-Mage is farming free?");
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
    expect(line()).toBeUndefined();
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
    // No item race and no lane results in this snapshot: the plain headline, never a style claim.
    expect(plan.story.headline).toBe("Win the fights around your item timings.");
    expect(plan.story.chapters[0]!.text).toBe("Medusa and Crystal Maiden win the safe lane against Terrorblade and Witch Doctor: take their tower. Survive the off lane against Anti-Mage and Lich: just get levels.");
    // Their late-game style label no longer says they scale better.
    expect(plan.teamFallbacks).toEqual([
      "Behind at 20? Defend towers together and only fight with your key spells ready.",
      "Ahead at 20? Take Roshan and push one lane together with the Aegis.",
    ]);
  });
});

describe("gamePlan skills", () => {
  const withSkills = (): Snapshot => ({
    ...data(),
    heroAbilities: {
      18: {
        abilities: [{ id: 1, key: "sven_storm_bolt", name: "Storm Hammer", slot: 1, maxLevel: 4, ultimate: false }],
        talents: [
          [
            { id: 10, name: "+2 Mana Regen" },
            { id: 11, name: "+15 Damage" },
          ],
        ],
      },
    },
    skillBuilds: {
      18: {
        3: {
          at: "2026-11-01T00:00:00Z",
          gameVersionId: 184,
          matches: 50,
          talents: [{ tier: 0, id: 10, share: 0.6, games: 50, level: 10 }],
          none: "no-agreement",
        },
      },
    },
  });
  const svenSkills = (input: Partial<Parameters<typeof gamePlan>[1]> = {}) => {
    const skills = gamePlan(new Engine(withSkills()), { ours, theirs, ...input }).players.find(
      (p) => p.heroId === 18,
    )?.skills;
    if (!skills) throw new Error("Expected Sven's skill plan");
    return skills;
  };

  it("adds the skill plan only for heroes with abilities in the snapshot", () => {
    expect(svenSkills().live).toBe("loading");
    expect(
      gamePlan(new Engine(withSkills()), { ours, theirs }).players.find((p) => p.heroId === 94)?.skills,
    ).toBeUndefined();
  });

  it("decides the talents from the matchup games and names the enemies", () => {
    const game = (match: number, id: number, won: boolean) => ({
      match,
      account: match,
      won,
      level: 12,
      version: 184,
      points: [id],
    });
    // +15 Damage won 30 and lost 5, +2 Mana Regen won 5 and lost 30.
    const games = Array.from({ length: 70 }, (_, i) => game(i + 1, i < 35 ? 11 : 10, i < 35 ? i < 30 : i < 40));
    const sven = svenSkills({ matchups: { 18: games } });
    expect(sven.live).toBe("ready");
    expect(sven.talents[0]).toMatchObject({ pick: 11, result: "recommended" });
    expect(sven.talents[0]?.reason).toMatch(/^Take \+15 Damage against Anti-Mage, Spectre, Terrorblade, Witch Doctor or Lich: /);
    // The odds and games, never raw wins and losses or a win rate (Can 2026-11-02).
    expect(sven.talents[0]?.odds).toMatch(/^\d+(\.\d)?x the odds · 70 games$/);
    expect(sven.talents[0]?.reason).not.toMatch(/won \d+ and lost|won\b[^.]*%/i);
  });

  it("tells a failed lookup from one that found no games", () => {
    expect(svenSkills({ matchups: null }).live).toBe("unavailable");
    expect(svenSkills({ matchups: {} }).live).toBe("ready");
    // A hero whose lookup didn't finish, while the others did.
    expect(svenSkills({ matchups: { 18: null, 94: [] } }).live).toBe("unavailable");
    expect(svenSkills({ matchups: "sign-in" }).live).toBe("sign-in");
  });
});
