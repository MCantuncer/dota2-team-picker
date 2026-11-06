/**
 * The fill dry run (plan "Auto-Fill My Heroes", step B0): reads one player's last 6 months from
 * STRATZ, OpenDota and our drafts, runs fillHeroes and reports where each game's position and
 * strength came from. Nothing is saved, so the thresholds can be checked on real STRATZ
 * positions before any player's My Heroes is filled.
 */
import type { HeroBenchmarks } from "../trends/benchmarks.ts";
import type { CountedDraftGame } from "../trends/drafts.ts";
import {
  isCountedGame,
  type Position,
  positionFromLane,
  type PositionSource,
  readRecentMatch,
  type RecentMatch,
  type TrendGame,
} from "../trends/games.ts";
import { mergeGames } from "../trends/merge.ts";
import { type CountedStratzGame, readStratzGames } from "../trends/stratz.ts";
import { fillHeroes, type FillResult, LOOKBACK_DAYS } from "./rules.ts";

/** The fill's own daily share of the OpenDota budget, so it never starves the other jobs. */
export const FILL_BUDGET = { caller: "fill", dailyCap: 200 } as const;
export const STRATZ_PAGE_SIZE = 100;
/** 1,000 games: more than 6 months for nearly every player. */
export const STRATZ_MAX_PAGES = 10;
/** Benchmark calls per run at most; games of heroes past this stay unjudged. */
export const MAX_BENCHMARK_CALLS = 20;
/** Below this share of games with a position, the rules go back to Can before any fill (plan go/no-go). */
export const GO_POSITIONED_SHARE = 0.7;
const DAY_S = 24 * 60 * 60;

export interface DryRunDeps {
  /** One page of the player's STRATZ games (the query's `data`), or null when STRATZ is off. */
  fetchStratzPage: (accountId: number, skip: number) => Promise<unknown | null>;
  /** The player's OpenDota games of the last `days`, as raw rows. Costs one OpenDota call. */
  fetchOpenDotaMatches: (accountId: number, days: number) => Promise<unknown[]>;
  /** The player's counted draft games inside the look-back. */
  fetchDraftGames: (userId: string) => Promise<CountedDraftGame[]>;
  /** Heroes and positions the player removed, as fillHeroes reads them. */
  fetchRemovals: (userId: string) => Promise<Set<string>>;
  cachedBenchmarks: (heroIds: number[]) => Promise<Map<number, HeroBenchmarks>>;
  /** Fetches one hero's benchmarks from OpenDota and caches them. Costs one OpenDota call. */
  fetchBenchmarks: (heroId: number) => Promise<HeroBenchmarks>;
  /** Takes n calls from the fill's OpenDota share; false when none are left today. */
  takeCalls: (n: number) => Promise<boolean>;
  nowS: () => number;
  log: (message: string, err: unknown) => void;
}

/** "partial": a later STRATZ page failed, so only the newer games are in. */
export type SourceStatus = "ok" | "off" | "partial" | "failed" | "no_budget";

export interface StrongCount {
  judged: number;
  strong: number;
}

export interface DryRunReport {
  accountId: number;
  lookbackDays: number;
  sources: {
    stratz: { status: SourceStatus; games: number; pages: number };
    openDota: { status: SourceStatus; games: number };
    drafts: { status: SourceStatus; games: number };
    benchmarks: { cached: number; fetched: number; missing: number };
  };
  coverage: {
    games: number;
    positioned: number;
    positionedShare: number;
    bySource: Record<PositionSource | "none", number>;
  };
  /** "go" when enough games have a position for the rules to be trusted. */
  verdict: "go" | "back_to_can";
  /** Strong games per position, by what judged them: STRATZ IMP or OpenDota stats. */
  strong: Record<Position, { imp: StrongCount; stats: StrongCount }>;
  fill: FillResult;
}

/** Runs the fill rules on one player's games without saving anything. */
export async function dryRun(userId: string, accountId: number, deps: DryRunDeps): Promise<DryRunReport> {
  const nowS = deps.nowS();
  const stratz = await stratzGames(accountId, nowS, deps);
  const openDota = await openDotaGames(accountId, nowS, deps);
  const drafts = await draftGames(userId, deps);
  const benchmarks = await benchmarksFor(openDota.matches, stratz.games, drafts.games, deps);
  const games = mergeGames(
    drafts.games,
    stratz.games,
    openDota.matches.map((match) => ({ match, benchmarks: benchmarks.found.get(match.heroId) })),
  );
  const removed = await deps.fetchRemovals(userId);
  const fill = fillHeroes({
    games: games.map((g) => ({
      heroId: g.heroId,
      startTime: g.startTime,
      isWin: g.isWin,
      position: g.position,
      isStrong: g.isStrong,
    })),
    nowS,
    removed,
  });
  const coverage = coverageOf(games);
  return {
    accountId,
    lookbackDays: LOOKBACK_DAYS,
    sources: {
      stratz: { status: stratz.status, games: stratz.games.length, pages: stratz.pages },
      openDota: { status: openDota.status, games: openDota.matches.length },
      drafts: { status: drafts.status, games: drafts.games.length },
      benchmarks: { cached: benchmarks.cached, fetched: benchmarks.fetched, missing: benchmarks.missing },
    },
    coverage,
    verdict: coverage.positionedShare >= GO_POSITIONED_SHARE ? "go" : "back_to_can",
    strong: strongCounts(games),
    fill,
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** How many raw games a STRATZ page had and the start of its oldest one, to know when to stop. */
export function stratzPageInfo(data: unknown): { count: number; oldest: number | null } {
  const player = isObj(data) && isObj(data.player) ? data.player : null;
  const matches = player && Array.isArray(player.matches) ? player.matches : [];
  const starts = matches.flatMap((m) =>
    isObj(m) && typeof m.startDateTime === "number" && Number.isFinite(m.startDateTime) ? [m.startDateTime] : []
  );
  return { count: matches.length, oldest: starts.length ? Math.min(...starts) : null };
}

/** STRATZ pages, newest first, until one is short or reaches past the look-back. */
async function stratzGames(accountId: number, nowS: number, deps: DryRunDeps) {
  const since = nowS - LOOKBACK_DAYS * DAY_S;
  const byId = new Map<number, CountedStratzGame>();
  let pages = 0;
  try {
    for (; pages < STRATZ_MAX_PAGES; pages++) {
      const data = await deps.fetchStratzPage(accountId, pages * STRATZ_PAGE_SIZE);
      if (data === null) return { status: "off" as const, games: [], pages };
      // New games can shift a page between calls; the map keeps one row per match.
      for (const g of readStratzGames(data, nowS, LOOKBACK_DAYS)) byId.set(g.matchId, g);
      const { count, oldest } = stratzPageInfo(data);
      if (count < STRATZ_PAGE_SIZE || oldest === null || oldest < since) {
        pages++;
        break;
      }
    }
  } catch (err) {
    deps.log(`STRATZ page ${pages + 1} for ${accountId} failed`, err);
    return { status: pages > 0 ? "partial" as const : "failed" as const, games: [...byId.values()], pages };
  }
  return { status: "ok" as const, games: [...byId.values()], pages };
}

async function openDotaGames(accountId: number, nowS: number, deps: DryRunDeps) {
  if (!(await deps.takeCalls(1))) return { status: "no_budget" as const, matches: [] };
  try {
    const rows = await deps.fetchOpenDotaMatches(accountId, LOOKBACK_DAYS);
    const matches = rows.flatMap((r) => {
      const match = readRecentMatch(r);
      return match && isCountedGame(match, nowS, LOOKBACK_DAYS) ? [match] : [];
    });
    return { status: "ok" as const, matches };
  } catch (err) {
    deps.log(`OpenDota games for ${accountId} failed`, err);
    return { status: "failed" as const, matches: [] };
  }
}

async function draftGames(userId: string, deps: DryRunDeps) {
  try {
    return { status: "ok" as const, games: await deps.fetchDraftGames(userId) };
  } catch (err) {
    deps.log(`Draft games for ${userId} failed`, err);
    return { status: "failed" as const, games: [] };
  }
}

/**
 * Benchmarks for the games judged by stats: a known position but no STRATZ IMP. Cached ones
 * first, then up to MAX_BENCHMARK_CALLS calls, most played heroes first.
 */
async function benchmarksFor(
  matches: RecentMatch[],
  stratz: CountedStratzGame[],
  drafts: CountedDraftGame[],
  deps: DryRunDeps,
) {
  const stratzById = new Map(stratz.map((g) => [g.matchId, g]));
  const draftById = new Map(drafts.map((g) => [g.matchId, g]));
  const gamesByHero = new Map<number, number>();
  for (const m of matches) {
    const s = stratzById.get(m.matchId);
    if (s && s.heroId === m.heroId && s.imp !== null) continue;
    const known = (s?.heroId === m.heroId && s.position !== null) || positionFromLane(m) !== null ||
      draftById.get(m.matchId)?.heroId === m.heroId;
    if (known) gamesByHero.set(m.heroId, (gamesByHero.get(m.heroId) ?? 0) + 1);
  }
  const heroIds = [...gamesByHero.keys()].sort((a, b) => gamesByHero.get(b)! - gamesByHero.get(a)!);
  const found = heroIds.length ? await deps.cachedBenchmarks(heroIds) : new Map<number, HeroBenchmarks>();
  const cached = found.size;
  let fetched = 0;
  for (const heroId of heroIds.filter((id) => !found.has(id))) {
    if (fetched >= MAX_BENCHMARK_CALLS || !(await deps.takeCalls(1))) break;
    try {
      found.set(heroId, await deps.fetchBenchmarks(heroId));
      fetched++;
    } catch (err) {
      deps.log(`Benchmarks for hero ${heroId} failed`, err);
      break;
    }
  }
  return { found, cached, fetched, missing: heroIds.length - found.size };
}

export function coverageOf(games: TrendGame[]): DryRunReport["coverage"] {
  const bySource = { stratz: 0, opendota: 0, draft: 0, none: 0 };
  for (const g of games) bySource[g.positionSource ?? "none"]++;
  const positioned = games.length - bySource.none;
  return {
    games: games.length,
    positioned,
    positionedShare: games.length ? Math.round((positioned / games.length) * 1000) / 1000 : 0,
    bySource,
  };
}

export function strongCounts(games: TrendGame[]): DryRunReport["strong"] {
  const empty = () => ({ imp: { judged: 0, strong: 0 }, stats: { judged: 0, strong: 0 } });
  const out = { 1: empty(), 2: empty(), 3: empty(), 4: empty(), 5: empty() } as DryRunReport["strong"];
  for (const g of games) {
    if (g.position === null || g.isStrong === null) continue;
    const count = out[g.position][g.imp !== null ? "imp" : "stats"];
    count.judged++;
    if (g.isStrong) count.strong++;
  }
  return out;
}
