import { describe, expect, it } from "vitest";
import {
  fetchSkillBuilds,
  guideRefs,
  listQuery,
  mostPicked,
  matchesQuery,
  skillRequests,
  toGuidePlayer,
} from "../src/data/skill-builds";
import type { HeroAbilities, Snapshot } from "../src/engine/types";
import { points, Q, R, SVEN, SVEN_BUILD, TOTALS, W, E } from "./skill-build-fixture";

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
      "m0: match(id: 5) { gameVersionId players(steamAccountId: 77) { heroId position level",
    );
    expect(() => listQuery([], [])).toThrow();
    expect(() => listQuery([{ heroId: 18, position: 1 }], [0])).toThrow();
    expect(() => matchesQuery([{ matchId: 1.5, steamAccountId: 77 }])).toThrow();
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
        },
      },
      70: {
        1: {
          at: "2026-10-20T00:00:00Z",
          gameVersionId: 181,
          matches: 30,
          talents: [],
        },
        3: {
          at: "2026-11-01T00:00:00Z",
          gameVersionId: 180,
          matches: 30,
          talents: [],
        },
      },
    };
    expect(skillRequests(snap, 181, now)).toEqual([
      { heroId: 70, position: 3 },
      { heroId: 70, position: 1 },
    ]);
  });

  it("fetches constants, lists and matches, and writes each slice", async () => {
    const snap = snapshot();
    const queries: string[] = [];
    const post = async (query: string): Promise<Record<string, unknown>> => {
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
      const count = (query.match(/ m\d+:/g) ?? []).length;
      return Object.fromEntries(
        [...Array(count)].map((_, i) => [
          `m${i}`,
          {
            gameVersionId: 181,
            players: [
              {
                heroId: 18,
                position: "POSITION_1",
                level: 18,
                abilities: points(SVEN_BUILD).map((abilityId, time) => ({
                  abilityId,
                  time,
                })),
              },
            ],
          },
        ]),
      );
    };
    const counts = await fetchSkillBuilds(snap, post, now);
    expect(counts).toEqual({ done: 1, due: 1, queries: 4, matchQueries: 2 });
    expect(snap.skillBuilds?.[18]?.[1]?.build?.levels).toEqual(SVEN_BUILD);
    expect(snap.heroAbilities?.[18]?.abilities).toHaveLength(4);
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
