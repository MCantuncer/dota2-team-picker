import { describe, expect, it } from "vitest";
import {
  fetchSkillBuilds,
  guideRefs,
  listQuery,
  mostPicked,
  matchesQuery,
  pathsCoverage,
  pathsLine,
  skillRequests,
  toGuidePlayer,
  toPathGame,
  validTalentRows,
} from "../src/data/skill-builds";
import type { ItemInfo, Snapshot } from "../src/engine/types";
import { points, Q, SVEN, SVEN_BUILD, TOTALS, W } from "./skill-build-fixture";

describe("queries and answers", () => {
  it("picks the most picked heroes to ask for guides against", () => {
    const stats = {
      1: { picks: [5, 5], wins: [0, 0] },
      2: { picks: [20, 0], wins: [0, 0] },
      3: { picks: [1, 1], wins: [0, 0] },
    };
    expect(mostPicked({ bracketStats: stats }, 2)).toEqual([2, 1]);
  });

  it("asks for the latest guides, guides against each opponent but the hero, and the totals", () => {
    const q = listQuery([{ heroId: 18, position: 1 }], [18, 1, 2, 3, 4, 5, 6, 7]);
    expect(q).toContain("g0_0: guide(heroId: 18, positionId: POSITION_1, take: 10)");
    expect(q).toContain("g0_1: guide(heroId: 18, positionId: POSITION_1, againstHeroId: 1, take: 10)");
    expect(q).toContain("g0_6: guide(heroId: 18, positionId: POSITION_1, againstHeroId: 6, take: 10)");
    expect(q).not.toContain("againstHeroId: 18");
    expect(q).not.toContain("g0_7");
    expect(q).toContain("x0: abilityMaxLevel(heroId: 18, positionIds: [POSITION_1])");
    expect(q).toContain("n0: abilityMinLevel(");
    expect(q).toContain("t0: talent(");
    expect(matchesQuery([{ matchId: 5, steamAccountId: 77 }])).toContain(
      "m0: match(id: 5) { gameVersionId durationSeconds players(steamAccountId: 77) { heroId position level",
    );
    expect(matchesQuery([{ matchId: 5, steamAccountId: 77 }])).toContain(
      "abilities { abilityId time } stats { itemPurchases { time itemId } } } }",
    );
    expect(() => listQuery([], [])).toThrow();
    expect(() => listQuery([{ heroId: 18, position: 1 }], [0])).toThrow();
    expect(() => matchesQuery([{ matchId: 1.5, steamAccountId: 77 }])).toThrow();
  });

  it("asks for talent win counts and keeps only sensible ones", () => {
    expect(listQuery([{ heroId: 18, position: 1 }], [])).toContain(
      "talent(heroId: 18, positionIds: [POSITION_1]) { abilityId matchCount winCount }",
    );
    expect(
      validTalentRows([
        { abilityId: 1, matchCount: 10, winCount: 6 },
        { abilityId: 2, matchCount: 10, winCount: 11 },
        { abilityId: 3, matchCount: 10 },
        { abilityId: 4 },
      ]),
    ).toEqual([
      { abilityId: 1, matchCount: 10, winCount: 6 },
      { abilityId: 2, matchCount: 10 },
      { abilityId: 3, matchCount: 10 },
    ]);
  });

  it("reads guide match ids and guide players defensively", () => {
    const guides = [
      { matchId: 3, steamAccountId: 7 },
      { matchId: 3, steamAccountId: 8 },
      { matchId: "x", steamAccountId: 9 },
      { matchId: 4 },
    ];
    expect(guideRefs([{ guides }, null])).toEqual([{ matchId: 3, steamAccountId: 7 }]);
    expect(guideRefs(null)).toEqual([]);
    const answer = (
      heroId: number,
      abilities: unknown[] = [
        { abilityId: W, time: 90 },
        { abilityId: Q, time: 0 },
      ],
    ) => ({
      gameVersionId: 200,
      players: [{ heroId, position: "POSITION_2", level: 2, isVictory: false, abilities }],
    });
    expect(toGuidePlayer(answer(18), 18)).toEqual({
      gameVersionId: 200,
      position: 2,
      level: 2,
      won: false,
      points: [Q, W],
    });
    // A point without a time would shift the levels after it.
    expect(toGuidePlayer(answer(18, [{ abilityId: Q }]), 18)).toBeNull();
    // The guide player was on another hero that game.
    expect(toGuidePlayer(answer(19), 18)).toBeNull();
    expect(toGuidePlayer({ gameVersionId: 200, players: [] }, 18)).toBeNull();
    expect(toGuidePlayer(null, 18)).toBeNull();
    expect(
      toGuidePlayer(
        {
          gameVersionId: 200,
          players: [
            {
              heroId: 18,
              position: "UNKNOWN",
              level: 1,
              abilities: [],
            },
          ],
        },
        18,
      ),
    ).toMatchObject({ position: null });
  });
});

describe("toPathGame", () => {
  const answer = (purchases: unknown, durationSeconds: unknown = 2400) => ({
    gameVersionId: 181,
    durationSeconds,
    players: [{ heroId: 42, stats: { itemPurchases: purchases } }],
  });
  it("reads the purchases in time order and the game's length", () => {
    const purchases = [
      { itemId: 137, time: 1000 },
      { itemId: 50, time: 480 },
    ];
    expect(toPathGame(answer(purchases))).toEqual({
      duration: 2400,
      items: [
        [50, 480],
        [137, 1000],
      ],
    });
  });
  it("leaves out a purchase without its id or time, keeping the game", () => {
    expect(toPathGame(answer([{ itemId: 50, time: 480 }, { itemId: 137 }, null]))?.items).toEqual([[50, 480]]);
  });
  it("is null without purchases or the game's length, so the game counts only for the skill build", () => {
    expect(toPathGame(answer(undefined))).toBeNull();
    expect(toPathGame(answer([], null))).toBeNull();
    expect(toPathGame({ gameVersionId: 181, durationSeconds: 2400, players: [{ heroId: 42 }] })).toBeNull();
    expect(toPathGame(null)).toBeNull();
  });
});

describe("pathsLine", () => {
  it("names each key item's groups, with or without a path", () => {
    expect(pathsLine({ heroId: 42, position: 1 }, 30, { 137: { late: 18, running: 25, onTime: 20 } })).toBe(
      "hero 42 pos 1: 30 wins with purchases; 137 late 18: 25 running, 20 on time, 5 late, no path",
    );
  });
});

describe("refresh", () => {
  const now = new Date("2026-11-02T00:00:00Z");
  const snapshot = (): Snapshot =>
    ({
      positions: { 18: [1000, 0, 0, 0, 0], 70: [800, 0, 200, 0, 0] },
      patch: { name: "7.39", startedAt: "2026-10-01T00:00:00Z" },
      bracketStats: { 1: { picks: [9], wins: [5] } },
    }) as unknown as Snapshot;

  it("refreshes missing, old and other-patch slices, oldest first", () => {
    const snap = snapshot();
    snap.skillBuilds = {
      18: {
        1: {
          at: "2026-10-30T00:00:00Z",
          gameVersionId: 181,
          matches: 30,
          talents: [],
          itemPaths: {},
        },
      },
      70: {
        1: {
          at: "2026-10-20T00:00:00Z",
          gameVersionId: 181,
          matches: 30,
          talents: [],
          itemPaths: {},
        },
        3: {
          at: "2026-11-01T00:00:00Z",
          gameVersionId: 180,
          matches: 30,
          talents: [],
          itemPaths: {},
        },
      },
    };
    expect(skillRequests(snap, 181, now)).toEqual([
      { heroId: 70, position: 3 },
      { heroId: 70, position: 1 },
    ]);
    // A fresh slice saved before item paths is due, with the missing ones.
    delete snap.skillBuilds[18]![1]!.itemPaths; // Set above.
    expect(skillRequests(snap, 181, now)).toEqual([
      { heroId: 18, position: 1 },
      { heroId: 70, position: 3 },
      { heroId: 70, position: 1 },
    ]);
  });

  /** STRATZ answers: Sven's constants, 25 guides for Sven pos 1, and each match from `match` by its id. */
  const stratz =
    (queries: string[], match: (id: number) => unknown) =>
    async (query: string): Promise<Record<string, unknown>> => {
      queries.push(query);
      if (query.includes("constants")) {
        return {
          constants: {
            gameVersions: [{ id: 181, name: "7.39" }],
            heroes: [
              {
                id: 18,
                abilities: SVEN.abilities.map((a, i) => ({
                  slot: i,
                  abilityId: a.id,
                })),
                talents: SVEN.talents.flat().map((t, slot) => ({ slot, abilityId: t.id })),
              },
            ],
            abilities: SVEN.abilities.map((a) => ({
              id: a.id,
              name: a.key,
              language: { displayName: a.name },
              stat: { maxLevel: a.maxLevel, isUltimate: a.ultimate },
            })),
          },
        };
      }
      if (query.includes("heroStats")) {
        return {
          heroStats: {
            g0_0: [
              {
                guides: [...Array(10)].map((_, i) => ({
                  matchId: i + 1,
                  steamAccountId: 100 + i,
                })),
              },
            ],
            g0_1: [
              {
                guides: [...Array(10)].map((_, i) => ({
                  matchId: i + 11,
                  steamAccountId: 110 + i,
                })),
              },
            ],
            g0_2: [
              {
                guides: [...Array(5)].map((_, i) => ({
                  matchId: i + 21,
                  steamAccountId: 120 + i,
                })),
              },
            ],
            x0: TOTALS.maxLevels,
            n0: TOTALS.firstLevels,
            t0: TOTALS.talents,
          },
        };
      }
      const ids = [...query.matchAll(/ m\d+: match\(id: (\d+)\)/g)].map((m) => Number(m[1]));
      return Object.fromEntries(ids.map((id, i) => [`m${i}`, match(id)]));
    };
  const svenGame = (extra: Record<string, unknown> = {}, player: Record<string, unknown> = {}) => ({
    gameVersionId: 181,
    ...extra,
    players: [
      {
        heroId: 18,
        position: "POSITION_1",
        level: 18,
        abilities: points(SVEN_BUILD).map((abilityId, time) => ({
          abilityId,
          time,
        })),
        ...player,
      },
    ],
  });

  it("fetches constants, lists and matches, and writes each slice", async () => {
    const snap = snapshot();
    const queries: string[] = [];
    const counts = await fetchSkillBuilds(snap, stratz(queries, () => svenGame()), now);
    expect(counts).toMatchObject({ done: 1, due: 1, queries: 4, matchQueries: 2 });
    expect(counts.largestMatchAnswer).toBeGreaterThan(0);
    expect(snap.skillBuilds?.[18]?.[1]?.build?.levels).toEqual(SVEN_BUILD);
    expect(snap.heroAbilities?.[18]?.abilities).toHaveLength(4);
    // No item data in the snapshot (its refresh failed): the paths stay unset, so the next run tries again.
    expect(snap.skillBuilds?.[18]?.[1]?.itemPaths).toBeUndefined();
    expect(counts.paths).toEqual([]);
  });

  it("saves empty paths when the answers have no purchases, so the slice isn't due again until next week", async () => {
    const snap = snapshot();
    snap.items = {};
    snap.itemTimings = {};
    const counts = await fetchSkillBuilds(snap, stratz([], () => svenGame()), now);
    expect(snap.skillBuilds?.[18]?.[1]?.itemPaths).toEqual({});
    expect(counts.paths).toEqual(["hero 18 pos 1: 0 wins with purchases; no key item passes"]);
    expect(skillRequests(snap, 181, now)).not.toContainEqual({ heroId: 18, position: 1 });
  });

  it("saves the late paths from the guide wins' purchases", async () => {
    const snap = snapshot();
    const item = (key: string, cost: number): ItemInfo => ({ key, name: key, cost, img: "", components: [] });
    // 50 Phase, 151 Armlet, 137 Radiance, 116 BKB, 200 to 202 three more big items for a usable slice.
    snap.items = {
      50: item("phase_boots", 1500),
      151: item("armlet", 2500),
      137: item("radiance", 4700),
      116: item("black_king_bar", 4050),
      200: item("assault", 5125),
      201: item("heart", 5000),
      202: item("satanic", 5050),
    };
    snap.itemTimings = {
      18: {
        1: {
          4: {
            games: 500,
            items: [
              [151, 12, 14],
              [137, 16, 18],
              [116, 22, 25],
              [200, 26, 30],
              [201, 30, 34],
              [202, 33, 37],
            ],
          },
        },
      },
    };
    const m = (minute: number) => minute * 60;
    // Matches 1 to 12: Radiance late (Armlet at 17, Radiance at 28). 13 to 22: Radiance at 16. 23: a loss,
    // 24: no purchases, 25: another position. Only the 22 wins with purchases at pos 1 count.
    const match = (id: number) => {
      const purchases: [number, number][] =
        id <= 12
          ? [[151, 17], [137, 28]]
          : [[137, 16], [116, 25]];
      const stats = { itemPurchases: purchases.map(([itemId, minute]) => ({ itemId, time: m(minute) })) };
      if (id === 24) return svenGame({ durationSeconds: m(40) }, { isVictory: true });
      if (id === 25) return svenGame({ durationSeconds: m(40) }, { isVictory: true, stats, position: "POSITION_3" });
      return svenGame({ durationSeconds: m(40) }, { isVictory: id !== 23, stats });
    };
    const counts = await fetchSkillBuilds(snap, stratz([], match), now);
    const paths = snap.skillBuilds?.[18]?.[1]?.itemPaths;
    expect(paths?.[137]).toEqual({
      late: 18,
      running: 22,
      onTime: 10,
      path: { games: 12, steps: [[151, 17, 12], [137, 28, 12]], keyLater: 12 },
    });
    expect(counts.paths[0]).toContain("hero 18 pos 1: 22 wins with purchases; 137 late 18: 22 running, 10 on time, 12 late, path 2 steps");
    expect(pathsCoverage(snap)).toEqual({ slices: 1, withPath: 1 });
  });

  it("stops before a batch that would pass the query budget", async () => {
    const snap = snapshot();
    const post = async (query: string): Promise<Record<string, unknown>> =>
      query.includes("constants")
        ? {
            constants: {
              gameVersions: [{ id: 181, name: "7.39" }],
              heroes: [{ id: 18, abilities: [{ slot: 0, abilityId: Q }] }],
              abilities: [
                {
                  id: Q,
                  name: "q",
                  language: { displayName: "Q" },
                  stat: { maxLevel: 4 },
                },
              ],
            },
          }
        : {};
    expect(await fetchSkillBuilds(snap, post, now, 2)).toEqual({
      done: 0,
      due: 1,
      queries: 1,
      matchQueries: 0,
      largestMatchAnswer: 0,
      paths: [],
    });
  });

  it("fails without a game version for the patch", async () => {
    const snap = snapshot();
    const post = async () => ({
      constants: {
        gameVersions: [],
        heroes: [{ id: 1 }],
        abilities: [{ id: 1 }],
      },
    });
    await expect(fetchSkillBuilds(snap, post, now)).rejects.toThrow("no game version");
  });
});
