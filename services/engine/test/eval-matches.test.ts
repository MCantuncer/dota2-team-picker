import { describe, expect, it } from "vitest";
import { isCandidate, mergeMatches, monthPath, toEvalMatch, type EvalMatch, type MatchDetail } from "../src/data/eval-matches";
import { matchPositionsQuery, MATCHES_PER_QUERY, toMatchPositions } from "../src/data/stratz";
import type { PublicMatch } from "../src/data/fetch";

const publicMatch = (over: Partial<PublicMatch> = {}): PublicMatch => ({
  match_id: 1,
  radiant_win: true,
  duration: 2400,
  lobby_type: 7,
  game_mode: 22,
  start_time: 1793000000,
  avg_rank_tier: 54,
  radiant_team: [1, 2, 3, 4, 5],
  dire_team: [6, 7, 8, 9, 10],
  ...over,
});

/** Picks alternate Dire, Radiant, ... like the real game below, then two bans. */
const detail = (over: Partial<MatchDetail> = {}): MatchDetail => ({
  match_id: 9062609080,
  radiant_win: false,
  duration: 2400,
  game_mode: 22,
  lobby_type: 7,
  start_time: 1793000000,
  picks_bans: [
    ...[6, 1, 7, 2, 8, 3, 9, 4, 10, 5].map((hero_id, order) => ({ is_pick: true, hero_id, team: order % 2 === 0 ? 1 : 0, order })),
    { is_pick: false, hero_id: 55, team: 0, order: 10 },
    { is_pick: false, hero_id: 90, team: 1, order: 11 },
  ],
  ...over,
});

describe("isCandidate", () => {
  it("takes a finished ranked All Pick game with all heroes known", () => {
    expect(isCandidate(publicMatch())).toBe(true);
  });

  it("skips other modes, unranked lobbies, short games and games still in progress", () => {
    expect(isCandidate(publicMatch({ game_mode: 1 }))).toBe(false);
    expect(isCandidate(publicMatch({ lobby_type: 0 }))).toBe(false);
    expect(isCandidate(publicMatch({ duration: 600 }))).toBe(false);
    expect(isCandidate(publicMatch({ duration: 0, radiant_team: [0, 0, 0, 0, 0] }))).toBe(false);
  });
});

describe("toEvalMatch", () => {
  it("keeps the picks in order with sides, positions and bans", () => {
    const m = toEvalMatch(detail(), 54, new Map([[6, 1], [1, 5]]))!;
    expect(m.id).toBe(9062609080);
    expect(m.rankTier).toBe(54);
    expect(m.radiantWin).toBe(false);
    expect(m.picks.map((p) => p.heroId)).toEqual([6, 1, 7, 2, 8, 3, 9, 4, 10, 5]);
    expect(m.picks[0]).toEqual({ heroId: 6, radiant: false, position: 1 });
    expect(m.picks[1]).toEqual({ heroId: 1, radiant: true, position: 5 });
    expect(m.picks[2]!.position).toBeNull();
    expect(m.bans).toEqual([55, 90]);
  });

  it("sorts picks by order even when OpenDota lists them out of order", () => {
    const rows = [...detail().picks_bans!].reverse();
    expect(toEvalMatch(detail({ picks_bans: rows }), null, undefined)!.picks[0]!.heroId).toBe(6);
  });

  it("rejects games that are not a complete ranked draft", () => {
    const picks = detail().picks_bans!;
    expect(toEvalMatch(detail({ game_mode: 1 }), null, undefined)).toBeNull();
    expect(toEvalMatch(detail({ duration: 300 }), null, undefined)).toBeNull();
    expect(toEvalMatch(detail({ picks_bans: null }), null, undefined)).toBeNull();
    expect(toEvalMatch(detail({ picks_bans: picks.slice(1) }), null, undefined)).toBeNull();
    const sameSide = picks.map((r) => ({ ...r, team: 0 }));
    expect(toEvalMatch(detail({ picks_bans: sameSide }), null, undefined)).toBeNull();
    const repeated = picks.map((r, i) => (i === 1 ? { ...r, hero_id: 6 } : r));
    expect(toEvalMatch(detail({ picks_bans: repeated }), null, undefined)).toBeNull();
  });
});

describe("monthPath and mergeMatches", () => {
  const match = (id: number, startTime: number): EvalMatch => ({ id, startTime, rankTier: null, radiantWin: true, picks: [], bans: [] });

  it("names one file per month the game started in", () => {
    expect(monthPath(Date.UTC(2026, 9, 31, 23) / 1000)).toBe("eval/matches-2026-10.json");
    expect(monthPath(Date.UTC(2026, 10, 1) / 1000)).toBe("eval/matches-2026-11.json");
  });

  it("adds only new ids and keeps the list oldest first", () => {
    const saved = [match(2, 200), match(1, 100)];
    const merged = mergeMatches(saved, [match(3, 150), { ...match(2, 999), radiantWin: false }]);
    expect(merged.map((m) => m.id)).toEqual([1, 3, 2]);
    expect(merged.find((m) => m.id === 2)!.radiantWin).toBe(true);
  });
});

describe("STRATZ match positions", () => {
  it("asks for players of up to MATCHES_PER_QUERY matches", () => {
    expect(matchPositionsQuery([1, 2])).toBe("{ matches(ids: [1, 2]) { id players { heroId position } } }");
    expect(() => matchPositionsQuery([])).toThrow();
    expect(() => matchPositionsQuery(Array.from({ length: MATCHES_PER_QUERY + 1 }, (_, i) => i + 1))).toThrow();
    expect(() => matchPositionsQuery([1.5])).toThrow();
  });

  it("maps hero to position and leaves out players it could not place", () => {
    const out = toMatchPositions([
      { id: 7, players: [{ heroId: 1, position: "POSITION_2" }, { heroId: 2, position: "UNKNOWN" }, { heroId: 3, position: null }] },
      { id: "bad", players: [] },
      { id: 8, players: null },
    ]);
    expect([...out.keys()]).toEqual([7, 8]);
    expect([...out.get(7)!]).toEqual([[1, 2]]);
    expect(out.get(8)!.size).toBe(0);
  });
});
