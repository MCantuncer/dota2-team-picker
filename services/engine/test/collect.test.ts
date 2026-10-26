import { describe, expect, it, vi } from "vitest";
import { collectMatches, type CollectDeps, type MonthStore } from "../src/data/collect";
import type { EvalMatch, MatchDetail } from "../src/data/eval-matches";
import type { PublicMatch } from "../src/data/fetch";
import type { Position } from "../src/engine/types";

const NOW = Date.UTC(2026, 9, 26, 12) / 1000;
const MONTH = "eval/matches-2026-10.json";

const listed = (id: number, over: Partial<PublicMatch> = {}): PublicMatch => ({
  match_id: id,
  radiant_win: true,
  duration: 2400,
  lobby_type: 7,
  game_mode: 22,
  start_time: NOW - 3600,
  avg_rank_tier: 54,
  radiant_team: [1, 2, 3, 4, 5],
  dire_team: [6, 7, 8, 9, 10],
  ...over,
});

const detail = (id: number): MatchDetail => ({
  match_id: id,
  radiant_win: true,
  duration: 2400,
  game_mode: 22,
  lobby_type: 7,
  start_time: NOW - 3600,
  picks_bans: [1, 6, 2, 7, 3, 8, 4, 9, 5, 10].map((hero_id, order) => ({ is_pick: true, hero_id, team: order % 2, order })),
});

const allPositions = (): Map<number, Position> => new Map([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((h) => [h, (((h - 1) % 5) + 1) as Position]));

function memoryStore(files: Record<string, EvalMatch[]> = {}): MonthStore & { files: Record<string, EvalMatch[]> } {
  return {
    files,
    load: vi.fn(async (path: string) => structuredClone(files[path] ?? [])),
    save: vi.fn(async (path: string, matches: EvalMatch[]) => {
      files[path] = matches;
    }),
  };
}

/** The newest public match, which only tells the collector where to start. */
const NEWEST = [listed(1_000_000, { duration: 0, radiant_team: [0, 0, 0, 0, 0] })];

function deps(over: Partial<CollectDeps> & { pages?: PublicMatch[][]; asked?: string[] } = {}): CollectDeps {
  const pages = over.pages ?? [[listed(3), listed(2, { game_mode: 1 }), listed(1)]];
  let page = 0;
  return {
    store: memoryStore(),
    openDota: (async (path: string) => {
      over.asked?.push(path);
      if (path === "/publicMatches") return NEWEST;
      if (path.startsWith("/publicMatches")) return pages[page++] ?? [];
      const id = Number(path.split("/")[2]);
      if (id === 404) throw new Error("GET failed: HTTP 404");
      return detail(id);
    }) as CollectDeps["openDota"],
    requestsLeft: () => 2000,
    matchPositions: async (ids) => new Map(ids.map((id) => [id, allPositions()])),
    now: NOW,
    max: 100,
    dryRun: false,
    ...over,
  };
}

describe("collectMatches", () => {
  it("saves new ranked games with pick order and positions to the month file", async () => {
    const d = deps();
    const result = await collectMatches(d);
    expect(result.candidates).toBe(2);
    expect(result.added.map((m) => m.id)).toEqual([3, 1]);
    const saved = (d.store as ReturnType<typeof memoryStore>).files[MONTH]!;
    expect(saved.map((m) => m.id)).toEqual([1, 3]);
    expect(saved[0]!.picks.every((p) => p.position !== null)).toBe(true);
    expect(saved[0]!.rankTier).toBe(54);
    expect(result.written).toEqual([{ path: MONTH, games: 2 }]);
  });

  it("starts the search about 3 hours of match ids below the newest game", async () => {
    const asked: string[] = [];
    await collectMatches(deps({ asked, pages: [[listed(3)], [listed(2)]], max: 2 }));
    expect(asked.slice(0, 3)).toEqual(["/publicMatches", "/publicMatches?less_than_match_id=850000", "/publicMatches?less_than_match_id=3"]);
  });

  it("skips games already saved and stops at --max", async () => {
    const old: EvalMatch = { id: 3, startTime: NOW - 7200, rankTier: null, radiantWin: true, picks: [], bans: [] };
    const store = memoryStore({ [MONTH]: [old] });
    const result = await collectMatches(deps({ store, max: 1, pages: [[listed(3), listed(5), listed(4)]] }));
    expect(result.added.map((m) => m.id)).toEqual([5]);
    expect(store.files[MONTH]!.map((m) => m.id)).toEqual([3, 5]);
  });

  it("keeps the other games when one match fails to load", async () => {
    const result = await collectMatches(deps({ pages: [[listed(404), listed(6)]] }));
    expect(result.added.map((m) => m.id)).toEqual([6]);
  });

  it("saves games without positions when STRATZ fails or there is no token", async () => {
    const failing = await collectMatches(deps({ matchPositions: async () => Promise.reject(new Error("STRATZ down")) }));
    expect(failing.added[0]!.picks.every((p) => p.position === null)).toBe(true);
    const noToken = await collectMatches(deps({ matchPositions: null }));
    expect(noToken.added).toHaveLength(2);
  });

  it("fills in positions for recent saved games that missed them", async () => {
    const missing: EvalMatch = {
      id: 9,
      startTime: NOW - 86400,
      rankTier: null,
      radiantWin: true,
      picks: [1, 6, 2, 7, 3, 8, 4, 9, 5, 10].map((heroId, i) => ({ heroId, radiant: i % 2 === 0, position: null })),
      bans: [],
    };
    const store = memoryStore({ [MONTH]: [missing] });
    const result = await collectMatches(deps({ store, pages: [[]] }));
    expect(result.filled).toBe(1);
    expect(store.files[MONTH]![0]!.picks[0]!.position).toBe(1);
  });

  it("does not write in a dry run, and stops when the daily allowance runs low", async () => {
    const store = memoryStore();
    const dry = await collectMatches(deps({ store, dryRun: true }));
    expect(dry.written).toHaveLength(1);
    expect(store.save).not.toHaveBeenCalled();
    const low = await collectMatches(deps({ requestsLeft: () => 100 }));
    expect(low.candidates).toBe(0);
    expect(low.written).toEqual([]);
  });

  it("reads the previous month too near the start of a month", async () => {
    const store = memoryStore();
    await collectMatches(deps({ store, now: Date.UTC(2026, 10, 1, 12) / 1000, pages: [[]] }));
    expect(store.load).toHaveBeenCalledWith("eval/matches-2026-10.json");
    expect(store.load).toHaveBeenCalledWith("eval/matches-2026-11.json");
  });
});
