/**
 * One run of the refresh-trends job: for each player whose check is due, read their recent
 * games from STRATZ (when a token is set), OpenDota and our party drafts, judge them by STRATZ IMP or the
 * heroes' OpenDota benchmarks, and save the games plus at most one new hero pool card. Every
 * OpenDota call comes from the trends share of the daily budget first; the run stops when the
 * budget, the run cap or a rate limit says so.
 */
import { buildFact, type FactItem, type FactRow } from "../feedback/fact.ts";
import type { GameSummary } from "../feedback/summary.ts";
import type { Match } from "../report/match.ts";
import type { BenchmarkStat, HeroBenchmarks } from "./benchmarks.ts";
import { isCountedGame, positionFromLane, readRecentMatch, type RecentMatch, type TrendGame } from "./games.ts";
import type { CountedDraftGame } from "./drafts.ts";
import { mergeGames, type StratzGame } from "./merge.ts";
import type { CountedStratzGame } from "./stratz.ts";
import { poolCardText } from "./reason.ts";
import { findPoolCandidates, type HeroRecord, pairKey, type PoolCandidate, type PoolEntry } from "./rules.ts";

/** The trends job's own name and daily share in the OpenDota budget. */
/** Shared by the hero pool cards and game feedback (plan: 500 a day for both). */
export const TRENDS_BUDGET = { caller: "trends", dailyCap: 500 } as const;
export const MAX_RUN_CALLS = 40;
/** Game feedback's own cap per run, after the cards, so neither starves the other. */
export const MAX_FACT_CALLS = 20;

/** A player claim_trend_players handed out. */
export interface TrendPlayer {
  user_id: string;
  account_id: number;
  hero_stats: Record<string, HeroRecord>;
  pool: PoolEntry[];
  skip: string[];
  has_recent_card: boolean;
}

/** A game row in the shape save_trend_check reads. */
export interface GameRow {
  match_id: number;
  hero_id: number;
  position: number | null;
  position_source: string | null;
  is_win: boolean;
  is_strong: boolean | null;
  imp: number | null;
  percentiles: Partial<Record<BenchmarkStat, number>> | null;
  stat_values: Partial<Record<BenchmarkStat, number>> | null;
  lobby_rank: number | null;
  started_at: string;
  game_mode: number;
  lobby_type: number;
}

export interface NewCard {
  heroId: number;
  position: number;
  question: string;
  reason: string;
  evidence: PoolCandidate;
}

export interface TrendCheck {
  state: "ok" | "hidden";
  games: GameRow[];
  newCard: NewCard | null;
  qualifying: string[];
}

export interface TrendDeps {
  /** Takes calls from the trends share; false when refused or the check failed. */
  takeCalls: (n: number) => Promise<boolean>;
  claimPlayers: () => Promise<TrendPlayer[]>;
  /**
   * The player's counted STRATZ games, or null when STRATZ is not set up. STRATZ has its own
   * limits, so these calls don't come from the OpenDota budget.
   */
  fetchStratzGames: (accountId: number) => Promise<CountedStratzGame[] | null>;
  /** The player's counted games from our party drafts, with their planned positions. */
  fetchDraftGames: (userId: string) => Promise<CountedDraftGame[]>;
  /** OpenDota's recentMatches rows, unchecked. */
  fetchRecentMatches: (accountId: number) => Promise<unknown[]>;
  /** Benchmarks fetched in the last 7 days, by hero id. */
  cachedBenchmarks: (heroIds: number[]) => Promise<Map<number, HeroBenchmarks>>;
  /** Fetches one hero's benchmarks from OpenDota and caches them. */
  fetchBenchmarks: (heroId: number) => Promise<HeroBenchmarks>;
  heroName: (heroId: number) => string;
  save: (userId: string, check: TrendCheck) => Promise<void>;
  nowS: () => number;
  log: (message: string, err?: unknown) => void;
  /** Game feedback (player_game_facts); left out, the run only does the cards. */
  facts?: FactsDeps;
}

export interface FactsDeps {
  /** Removes rows older than KEEP_DAYS. */
  purge: () => Promise<void>;
  /** Rows waiting for a parse whose next try is due, oldest first. */
  dueRows: () => Promise<FactItem[]>;
  /** Games with no row yet, picked by pickNewGames. */
  newGames: () => Promise<FactItem[]>;
  fetchMatch: (matchId: number) => Promise<unknown | null>;
  requestParse: (matchId: number) => Promise<void>;
  summarize: (match: Match, item: FactItem) => GameSummary | null;
  /** Upserts the row on (user_id, match_id). */
  save: (row: FactRow) => Promise<void>;
  now: () => Date;
}

type StopReason = "run cap" | "daily budget" | "rate limit";

export interface TrendRunResult {
  checked: number;
  cards: number;
  calls: number;
  stopped: StopReason | null;
  /** Game feedback rows saved, and the calls they used (also counted in `calls`). */
  facts: number;
  factCalls: number;
  factsStopped: StopReason | null;
}

/** OpenDota said 429: the run stops and the rest waits for the next one. */
export class OpenDotaBusy extends Error {}

class Stop extends Error {
  constructor(readonly reason: "run cap" | "daily budget") {
    super(reason);
  }
}

export async function runTrends(deps: TrendDeps, maxCalls = MAX_RUN_CALLS): Promise<TrendRunResult> {
  const result: TrendRunResult = {
    checked: 0,
    cards: 0,
    calls: 0,
    stopped: null,
    facts: 0,
    factCalls: 0,
    factsStopped: null,
  };
  const take = async (n: number) => {
    if (result.calls + n > maxCalls) throw new Stop("run cap");
    if (!(await deps.takeCalls(n))) throw new Stop("daily budget");
    result.calls += n;
  };
  for (const player of await deps.claimPlayers()) {
    try {
      const check = await checkPlayer(player, deps, take);
      await deps.save(player.user_id, check);
      result.checked++;
      if (check.newCard) result.cards++;
    } catch (err) {
      if (err instanceof Stop) {
        result.stopped = err.reason;
        break;
      }
      if (err instanceof OpenDotaBusy) {
        result.stopped = "rate limit";
        break;
      }
      // One player's error never stops the others; their check comes again in 12 hours.
      deps.log(`Trend check for ${player.user_id} failed`, err);
    }
  }
  if (deps.facts && result.stopped !== "daily budget" && result.stopped !== "rate limit") {
    await runFacts(deps.facts, deps, result);
  }
  return result;
}

const isStop = (err: unknown) => err instanceof Stop || err instanceof OpenDotaBusy;
const stopReason = (err: unknown): StopReason => (err instanceof Stop ? err.reason : "rate limit");

/**
 * Game feedback after the cards: drop old rows, then build due rows and new games until the
 * feedback cap, the daily budget or a rate limit stops it. One game's error never stops the rest.
 */
async function runFacts(facts: FactsDeps, deps: TrendDeps, result: TrendRunResult) {
  const take = async (n: number) => {
    if (result.factCalls + n > MAX_FACT_CALLS) throw new Stop("run cap");
    if (!(await deps.takeCalls(n))) throw new Stop("daily budget");
    result.factCalls += n;
    result.calls += n;
  };
  try {
    await facts.purge();
    const items = [...await facts.dueRows(), ...await facts.newGames()];
    for (const item of items) {
      const row = await buildFact(item, {
        take,
        fetchMatch: facts.fetchMatch,
        requestParse: facts.requestParse,
        summarize: facts.summarize,
        now: facts.now(),
      }, isStop);
      if (!row) continue;
      try {
        await facts.save(row);
        result.facts++;
      } catch (err) {
        deps.log(`Saving game ${item.match_id} for ${item.user_id} failed`, err);
      }
    }
  } catch (err) {
    if (!isStop(err)) {
      deps.log("Game feedback failed", err);
      return;
    }
    result.factsStopped = stopReason(err);
  }
}

async function checkPlayer(player: TrendPlayer, deps: TrendDeps, take: (n: number) => Promise<void>) {
  const stratz = await stratzGamesOf(player, deps);
  const drafts = await draftGamesOf(player, deps);
  await take(1);
  const raw = await deps.fetchRecentMatches(player.account_id);
  if (raw.length === 0 && !stratz.length && !drafts.length && Object.keys(player.hero_stats).length > 0) {
    // Games on record but none shown: most likely "Expose public match data" is off.
    return { state: "hidden", games: [], newCard: null, qualifying: [] } satisfies TrendCheck;
  }
  const nowS = deps.nowS();
  const matches = raw.flatMap((r) => {
    const match = readRecentMatch(r);
    return match && isCountedGame(match, nowS) ? [match] : [];
  });
  const benchmarks = await benchmarksFor(matches, stratz, drafts, deps, take);
  const games = mergeGames(
    drafts,
    stratz,
    matches.map((match) => ({ match, benchmarks: benchmarks.get(match.heroId) })),
  );
  const candidates = findPoolCandidates({
    games,
    pool: player.pool,
    heroRecords: player.hero_stats,
    skip: new Set(player.skip),
    nowS,
  });
  const best = candidates[0];
  const newCard = best && !player.has_recent_card ? toCard(best, deps.heroName(best.heroId)) : null;
  return {
    state: "ok",
    games: games.map((g) => toRow(g, matches, stratz, drafts)),
    newCard,
    qualifying: candidates.map((c) => pairKey(c.heroId, c.position)),
  } satisfies TrendCheck;
}

/** STRATZ games, or none when STRATZ is off or fails: one source failing never stops the check. */
async function stratzGamesOf(player: TrendPlayer, deps: TrendDeps): Promise<CountedStratzGame[]> {
  try {
    return (await deps.fetchStratzGames(player.account_id)) ?? [];
  } catch (err) {
    deps.log(`STRATZ games for ${player.user_id} failed; using OpenDota alone`, err);
    return [];
  }
}

/** Draft games, or none when reading them fails: the check goes on with the other sources. */
async function draftGamesOf(player: TrendPlayer, deps: TrendDeps): Promise<CountedDraftGame[]> {
  try {
    return await deps.fetchDraftGames(player.user_id);
  } catch (err) {
    deps.log(`Draft games for ${player.user_id} failed; using the other sources`, err);
    return [];
  }
}

/**
 * Benchmarks for the games judged by stats: a known position (STRATZ or lane) but no STRATZ
 * IMP. Cached ones first, then one call each.
 */
async function benchmarksFor(
  matches: RecentMatch[],
  stratz: StratzGame[],
  drafts: CountedDraftGame[],
  deps: TrendDeps,
  take: (n: number) => Promise<void>,
) {
  const stratzById = new Map(stratz.map((g) => [g.matchId, g]));
  const draftById = new Map(drafts.map((g) => [g.matchId, g]));
  const needed = matches.filter((m) => {
    const s = stratzById.get(m.matchId);
    if (s && s.heroId === m.heroId && s.imp !== null) return false;
    return (s?.heroId === m.heroId && s.position !== null) || positionFromLane(m) !== null ||
      draftById.get(m.matchId)?.heroId === m.heroId;
  });
  const heroIds = [...new Set(needed.map((m) => m.heroId))];
  const found = heroIds.length ? await deps.cachedBenchmarks(heroIds) : new Map<number, HeroBenchmarks>();
  for (const heroId of heroIds.filter((id) => !found.has(id))) {
    await take(1);
    found.set(heroId, await deps.fetchBenchmarks(heroId));
  }
  return found;
}

function toCard(candidate: PoolCandidate, heroName: string): NewCard {
  const { question, reason } = poolCardText(candidate, heroName);
  return { heroId: candidate.heroId, position: candidate.position, question, reason, evidence: candidate };
}

function toRow(
  game: TrendGame,
  matches: RecentMatch[],
  stratz: CountedStratzGame[],
  drafts: CountedDraftGame[],
): GameRow {
  const match = matches.find((m) => m.matchId === game.matchId) ??
    stratz.find((g) => g.matchId === game.matchId) ?? drafts.find((g) => g.matchId === game.matchId);
  return {
    match_id: game.matchId,
    hero_id: game.heroId,
    position: game.position,
    position_source: game.positionSource,
    is_win: game.isWin,
    is_strong: game.isStrong,
    imp: game.imp,
    percentiles: game.percentiles,
    stat_values: game.statValues,
    lobby_rank: null,
    started_at: new Date(game.startTime * 1000).toISOString(),
    game_mode: match?.gameMode ?? 0,
    lobby_type: match?.lobbyType ?? 0,
  };
}
