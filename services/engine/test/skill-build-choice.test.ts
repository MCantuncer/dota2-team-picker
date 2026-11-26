import { describe, expect, it } from "vitest";
import { agreesWithTotals, buildKey, chooseTalents, toSkillSlice } from "../src/data/skill-build-choice";
import { getsPointEveryLevel, learnedHero, toSequence } from "../src/data/skill-sequence";
import type { HeroAbilities } from "../src/engine/types";
import {
  E,
  PATCH,
  player,
  Q,
  R,
  SVEN,
  SVEN_BUILD,
  SVEN_POINTS,
  TOTALS,
  W,
  WARCRY_SECOND,
  WARCRY_SECOND_POINTS,
} from "./skill-build-fixture";

describe("toSequence", () => {
  const seq = (points: number[], level = 18) => toSequence({ points, level }, SVEN);

  it("places abilities at their levels, with each talent beside the ability before it", () => {
    expect(seq(SVEN_POINTS)).toEqual({
      levels: SVEN_BUILD,
      talents: [
        { id: 11, level: 10 },
        { id: 13, level: 15 },
      ],
    });
    // Level 20: the level 20 talent too.
    expect(seq([...SVEN_POINTS, 15], 20)?.talents.at(-1)).toEqual({ id: 15, level: 20 });
  });

  it("places a talent taken after the next ability at that ability's level", () => {
    const late = [Q, E, W, W, W, R, W, Q, Q, Q, E, 11, R, E, E, 13, R];
    expect(seq(late)).toEqual({ levels: SVEN_BUILD, talents: [{ id: 11, level: 11 }, { id: 13, level: 15 }] });
  });

  it("holds an ultimate point until the level it opens at", () => {
    // Nothing else taken at 11: the second God's Strength waits for 12.
    const early = [Q, E, W, W, W, R, W, Q, Q, Q, 11, R, E, E, E, 13, R];
    expect(seq(early)?.levels.slice(9, 13)).toEqual([Q, 0, R, E]);
    // Meepo's Divided We Stand opens at 3 and 10.
    const meepo: HeroAbilities = {
      ...SVEN,
      abilities: SVEN.abilities.map((a) => (a.id === R ? { ...a, key: "meepo_divided_we_stand", maxLevel: 4 } : a)),
    };
    const meepoPoints = [W, Q, R, E, E, E, E, W, W, R, 11, W, Q, Q, Q, 13, R];
    expect(toSequence({ points: meepoPoints, level: 18 }, meepo)?.levels.slice(0, 10)).toEqual([W, Q, R, E, E, E, E, W, W, R]);
  });

  it("gives a point every level to a hero that gets one (Invoker)", () => {
    const invoker: HeroAbilities = {
      abilities: [Q, W, E].map((id) => ({
        id,
        key: `orb${id}`,
        name: `Orb ${id}`,
        slot: id,
        maxLevel: 8,
        ultimate: false,
      })),
      talents: [],
    };
    const orbs = [E, Q, E, W, E, Q, E, W, E, Q, E, W, E, Q, W, Q, W, Q];
    expect(toSequence({ points: orbs, level: 18 }, invoker, true)).toEqual({ levels: orbs, talents: [] });
    // Under the skip rule 18 points need level 20.
    expect(toSequence({ points: orbs, level: 18 }, invoker)).toBeNull();
  });

  it("tells a hero with a point every level from the games past level 17", () => {
    const sven = { points: SVEN_POINTS, level: 18 };
    const invoker = { points: [...Array(18)].map(() => Q), level: 18 };
    expect(getsPointEveryLevel([sven, sven, invoker])).toBe(false);
    expect(getsPointEveryLevel([invoker, invoker, sven])).toBe(true);
    // Games that ended before 18 say nothing.
    expect(getsPointEveryLevel([{ points: [Q], level: 16 }])).toBe(false);
  });

  it("keeps points not spent when the game ended, but drops a point past the last level", () => {
    expect(seq(SVEN_POINTS.slice(0, 16), 20)?.levels).toEqual(SVEN_BUILD.slice(0, 14));
    expect(seq(SVEN_POINTS, 17)).toBeNull();
  });

  it("rejects a game with fewer than 16 points", () => {
    expect(seq(SVEN_POINTS.slice(0, 15))).toBeNull();
  });

  it("rejects an unknown id in the shown levels but not after them", () => {
    expect(seq([...SVEN_POINTS.slice(0, 11), 0, ...SVEN_POINTS.slice(12)])).toBeNull();
    expect(seq([...SVEN_POINTS, 0], 20)?.levels).toEqual(SVEN_BUILD);
  });

  it("rejects an ability past its max", () => {
    expect(seq([Q, Q, Q, Q, Q, ...SVEN_POINTS.slice(5)])).toBeNull();
  });
});

describe("learnedHero", () => {
  it("keeps the abilities guide players put points in and counts unknown max levels", () => {
    const hero = {
      ...SVEN,
      abilities: [
        ...SVEN.abilities.map((a) => (a.id === R ? { ...a, maxLevel: 0 } : a)),
        {
          id: 9,
          key: "x_sub",
          name: "Sub",
          slot: 4,
          maxLevel: 0,
          ultimate: false,
        },
      ],
    };
    const three = [player(SVEN_POINTS), player(SVEN_POINTS), player(SVEN_POINTS)];
    const learned = learnedHero(hero, three);
    expect(learned.abilities.map((a) => a.id)).toEqual([Q, W, E, R]);
    expect(learned.abilities.find((a) => a.id === R)?.maxLevel).toBe(3);
    // Two games are too few to trust the count: the max level stays unknown.
    expect(learnedHero(hero, three.slice(0, 2)).abilities.find((a) => a.id === R)?.maxLevel).toBe(0);
  });
});

describe("buildKey and agreesWithTotals", () => {
  it("keys a build by max order and the abilities with a point by level 4", () => {
    expect(buildKey(SVEN_BUILD, SVEN)).toBe("2>1>3|1,2,3");
    expect(buildKey(WARCRY_SECOND, SVEN)).toBe("2>3>1|1,2,3");
    // Cleave at 2 instead of 3 is the same plan; Warcry first at 8 is not.
    expect(buildKey([Q, W, E, ...SVEN_BUILD.slice(3)], SVEN)).toBe("2>1>3|1,2,3");
    expect(buildKey([Q, W, W, W, R, W, E, ...SVEN_BUILD.slice(7)].slice(0, 18), SVEN)).toMatch(/\|1,2$/);
  });

  it("agrees when STRATZ's most common levels give the same key", () => {
    expect(agreesWithTotals(buildKey(SVEN_BUILD, SVEN), TOTALS, SVEN)).toBe(true);
    expect(agreesWithTotals(buildKey(WARCRY_SECOND, SVEN), TOTALS, SVEN)).toBe(false);
  });

  it("treats abilities maxed after level 18 in the totals as not maxed, like the games", () => {
    // A support build: only Hammer maxed by 18; Cleave and Warcry maxed at 20 and 19 in the totals.
    const support = [Q, W, E, Q, Q, R, Q, W, E, W, 0, R, W, E, E, 0, 0, R];
    const totals = {
      ...TOTALS,
      maxLevels: [
        { abilityId: Q, level: 7, matchCount: 900 },
        { abilityId: W, level: 20, matchCount: 900 },
        { abilityId: E, level: 19, matchCount: 900 },
      ],
      firstLevels: [
        { abilityId: Q, level: 1, matchCount: 900 },
        { abilityId: W, level: 2, matchCount: 900 },
        { abilityId: E, level: 3, matchCount: 900 },
      ],
    };
    expect(buildKey(support, SVEN)).toBe("1>2>3|1,2,3");
    expect(agreesWithTotals(buildKey(support, SVEN), totals, SVEN)).toBe(true);
  });

  it("does not agree when an ability has no first-point total", () => {
    const totals = {
      ...TOTALS,
      firstLevels: TOTALS.firstLevels.filter((r) => r.abilityId !== W),
    };
    expect(agreesWithTotals(buildKey(SVEN_BUILD, SVEN), totals, SVEN)).toBe(false);
  });
});

describe("toSkillSlice", () => {
  const now = new Date("2026-11-02T00:00:00Z");

  it("gives the common Sven pos 1 build: Q E W W W R W Q Q Q E R E E, R at 18", () => {
    const players = [...Array(20)].map(() => player(SVEN_POINTS)).concat([...Array(5)].map(() => player(WARCRY_SECOND_POINTS)));
    const slice = toSkillSlice(players, 1, TOTALS, SVEN, PATCH, now);
    expect(slice.build).toEqual({
      levels: SVEN_BUILD,
      groupMatches: 20,
      share: 0.8,
      exactMatches: 20,
    });
    expect(slice.matches).toBe(25);
    expect(slice.none).toBeUndefined();
    // Warcry second holds 20% of the matches, under the 25% for an alternative.
    expect(slice.alternative).toBeUndefined();
  });

  it("shows a second build when it is common in the matches and in STRATZ's totals", () => {
    const players = [...Array(14)]
      .map(() => player(SVEN_POINTS))
      .concat([...Array(10)].map(() => player(WARCRY_SECOND_POINTS)));
    const slice = toSkillSlice(players, 1, TOTALS, SVEN, PATCH, now);
    expect(slice.build?.levels).toEqual(SVEN_BUILD);
    // Warcry maxed at 14 in 90k of 113k games.
    expect(slice.alternative).toMatchObject({
      levels: WARCRY_SECOND,
      groupMatches: 10,
    });
  });

  it("keeps only the hero's position and games since the patch started", () => {
    const players = [...Array(20)]
      .map(() => player(SVEN_POINTS))
      .concat([player(SVEN_POINTS, { position: 2 }), player(SVEN_POINTS, { start: 999 })]);
    expect(toSkillSlice(players, 1, TOTALS, SVEN, PATCH, now).matches).toBe(20);
  });

  it("has no build with too few matches", () => {
    const slice = toSkillSlice(
      [...Array(19)].map(() => player(SVEN_POINTS)),
      1,
      TOTALS,
      SVEN,
      PATCH,
      now,
    );
    expect(slice.none).toBe("few-matches");
    expect(slice.build).toBeUndefined();
  });

  it("has no build when the biggest group disagrees with STRATZ's totals", () => {
    const players = [...Array(20)].map(() => player(WARCRY_SECOND_POINTS));
    expect(toSkillSlice(players, 1, TOTALS, SVEN, PATCH, now).none).toBe("no-agreement");
  });

  it("counts the exact build apart from its group", () => {
    // Same group (max order and first points), different ultimate level.
    const late = [...SVEN_POINTS];
    [late[5], late[6]] = [W, R];
    const players = [...Array(12)].map(() => player(SVEN_POINTS)).concat([...Array(9)].map(() => player(late)));
    expect(toSkillSlice(players, 1, TOTALS, SVEN, PATCH, now).build).toMatchObject({
      groupMatches: 21,
      exactMatches: 12,
    });
  });
});

describe("talents", () => {
  const placed = (points: number[]) => {
    const p = toSequence({ points, level: 18 }, SVEN);
    if (!p) throw new Error("fixture build should place");
    return p;
  };
  const sven = placed(SVEN_POINTS);
  it("picks the talent with more games and the level players took it", () => {
    const talents = chooseTalents(TOTALS.talents, [sven, sven, placed(WARCRY_SECOND_POINTS)], SVEN);
    expect(talents).toEqual([
      { tier: 0, id: 11, share: 0.83, games: 94000, level: 10 },
      { tier: 1, id: 13, share: 0.74, games: 116000, level: 15 },
    ]);
  });

  it("keeps both sides' games and wins when STRATZ gives win counts", () => {
    const totals = [
      { abilityId: 10, matchCount: 16000, winCount: 8800 },
      { abilityId: 11, matchCount: 78000, winCount: 39000 },
    ];
    expect(chooseTalents(totals, [sven], SVEN)[0]?.sides).toEqual([
      { id: 10, games: 16000, wins: 8800 },
      { id: 11, games: 78000, wins: 39000 },
    ]);
    // A row without wins leaves the tier without sides rather than claim 0 wins.
    expect(chooseTalents([...totals, { abilityId: 12, matchCount: 5 }], [sven], SVEN)[0]?.sides).toBeUndefined();
  });

  it("skips a tier with one talent rather than claim everyone picks it", () => {
    const hero = { ...SVEN, talents: SVEN.talents.map((pair, tier) => (tier === 0 ? pair.slice(1) : pair)) };
    expect(chooseTalents(TOTALS.talents, [sven], hero).map((t) => t.tier)).toEqual([1]);
  });

  it("places a tier at its usual level when no game reached it", () => {
    const talents = chooseTalents([{ abilityId: 16, matchCount: 10 }], [sven], SVEN);
    expect(talents).toEqual([{ tier: 3, id: 16, share: 1, games: 10, level: 25 }]);
  });
});
