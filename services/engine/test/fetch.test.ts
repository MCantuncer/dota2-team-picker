import { describe, expect, it } from "vitest";
import { applyPatch, countMatch, decayCounts, laneRolesDue } from "../src/data/fetch";
import { dailyPath } from "../src/data/upload";
import type { Snapshot } from "../src/engine/types";

const empty = (): Snapshot => ({ generatedAt: "", heroes: {}, bracketStats: {}, matchups: {}, synergy: {}, laneRoles: {} });

describe("countMatch", () => {
  it("adds matchups and synergy for a finished ranked game", () => {
    const data = empty();
    const counted = countMatch(data, {
      match_id: 1,
      radiant_win: true,
      duration: 2400,
      lobby_type: 7,
      game_mode: 22,
      start_time: 1792800000,
      radiant_team: [1, 2, 3, 4, 5],
      dire_team: [6, 7, 8, 9, 10],
    });
    expect(counted).toBe(true);
    expect(data.matchups[1]![6]).toEqual({ games: 1, wins: 1 });
    expect(data.matchups[6]![1]).toEqual({ games: 1, wins: 0 });
    expect(data.synergy["1-2"]).toEqual({ games: 1, wins: 1 });
    expect(data.synergy["6-7"]).toEqual({ games: 1, wins: 0 });
  });

  it("also counts the match in its rank group", () => {
    const data = empty();
    const m = {
      match_id: 1,
      radiant_win: false,
      duration: 2400,
      lobby_type: 7,
      game_mode: 22,
      start_time: 1792800000,
      avg_rank_tier: 54,
      radiant_team: [1, 2, 3, 4, 5],
      dire_team: [6, 7, 8, 9, 10],
    };
    countMatch(data, m);
    expect(data.rankMatchups?.[3]?.[6]?.[1]).toEqual({ games: 1, wins: 1 });
    expect(data.rankSynergy?.[3]?.["1-2"]).toEqual({ games: 1, wins: 0 });
    countMatch(data, { ...m, match_id: 2, avg_rank_tier: null });
    expect(data.matchups[6]![1]).toEqual({ games: 2, wins: 2 });
    expect(data.rankMatchups?.[3]?.[6]?.[1]).toEqual({ games: 1, wins: 1 });
  });

  it("skips turbo and early abandons", () => {
    const data = empty();
    const base = { match_id: 1, radiant_win: true, lobby_type: 0, start_time: 1792800000, radiant_team: [1, 2, 3, 4, 5], dire_team: [6, 7, 8, 9, 10] };
    expect(countMatch(data, { ...base, duration: 2400, game_mode: 23 })).toBe(false);
    expect(countMatch(data, { ...base, duration: 300, game_mode: 22 })).toBe(false);
  });
});

describe("decayCounts", () => {
  it("fades counts by 1% per day since the last run", () => {
    const data = { ...empty(), generatedAt: "2026-10-20T00:00:00Z" };
    data.matchups = { 1: { 2: { games: 100, wins: 50 } } };
    data.synergy = { "1-2": { games: 100, wins: 50 } };
    decayCounts(data, new Date("2026-10-22T00:00:00Z"));
    expect(data.matchups[1]![2]).toEqual({ games: 98, wins: 49 });
    expect(data.synergy["1-2"]).toEqual({ games: 98, wins: 49 });
  });

  it("leaves a fresh snapshot alone", () => {
    const data = empty();
    data.synergy = { "1-2": { games: 10, wins: 5 } };
    decayCounts(data, new Date());
    expect(data.synergy["1-2"]).toEqual({ games: 10, wins: 5 });
  });
});

describe("laneRolesDue", () => {
  it("refreshes lane roles once a week", () => {
    const data = { ...empty(), laneRolesAt: "2026-10-20T00:00:00Z" };
    expect(laneRolesDue(data, new Date("2026-10-26T00:00:00Z"))).toBe(false);
    expect(laneRolesDue(data, new Date("2026-10-27T00:00:00Z"))).toBe(true);
    expect(laneRolesDue(empty(), new Date())).toBe(true);
  });
});

describe("dailyPath", () => {
  it("names the daily copy after the day the data was made", () => {
    expect(dailyPath({ ...empty(), generatedAt: "2026-10-23T09:06:00.000Z" })).toBe("daily/2026-10-23.json");
  });
});

describe("applyPatch", () => {
  const patch741 = { name: "7.41", date: "2026-03-24T00:50:59.580Z" };
  const patch742 = { name: "7.42", date: "2026-11-01T00:00:00.000Z" };

  it("keeps the counts on the same patch", () => {
    const data = { ...empty(), patch: { name: "7.41", startedAt: patch741.date } };
    data.synergy = { "1-2": { games: 100, wins: 60 } };
    expect(applyPatch(data, patch741)).toBe(false);
    expect(data.synergy["1-2"]).toEqual({ games: 100, wins: 60 });
  });

  it("cuts the counts to a quarter on a new patch", () => {
    const data = { ...empty(), patch: { name: "7.41", startedAt: patch741.date } };
    data.matchups = { 1: { 2: { games: 100, wins: 60 } } };
    data.synergy = { "1-2": { games: 100, wins: 60 } };
    data.rankSynergy = { 2: { "1-2": { games: 40, wins: 20 } } };
    expect(applyPatch(data, patch742)).toBe(true);
    expect(data.rankSynergy[2]!["1-2"]).toEqual({ games: 10, wins: 5 });
    expect(data.matchups[1]![2]).toEqual({ games: 25, wins: 15 });
    expect(data.synergy["1-2"]).toEqual({ games: 25, wins: 15 });
    expect(data.patch).toEqual({ name: "7.42", startedAt: patch742.date });
  });

  it("only records the patch the first time", () => {
    const data = empty();
    data.synergy = { "1-2": { games: 100, wins: 60 } };
    expect(applyPatch(data, patch741)).toBe(false);
    expect(data.synergy["1-2"]).toEqual({ games: 100, wins: 60 });
    expect(data.patch?.name).toBe("7.41");
  });
});
