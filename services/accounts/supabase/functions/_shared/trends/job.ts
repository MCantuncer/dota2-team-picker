/**
 * One run of the refresh-trends job: for each player whose check is due, read their recent
 * games from STRATZ (when a token is set) and OpenDota, judge them by STRATZ IMP or the
 * heroes' OpenDota benchmarks, and save the games plus at most one new hero pool card. Every
 * OpenDota call comes from the trends share of the daily budget first; the run stops when the
 * budget, the run cap or a rate limit says so.
 */
import type { BenchmarkStat, HeroBenchmarks } from "./benchmarks.ts";
import { isCountedGame, positionFromLane, readRecentMatch, type RecentMatch, type TrendGame } from "./games.ts";
import { mergeGames, type StratzGame } from "./merge.ts";
import type { CountedStratzGame } from "./stratz.ts";
import { poolCardText } from "./reason.ts";
import { findPoolCandidates, type HeroRecord, pairKey, type PoolCandidate, type PoolEntry } from "./rules.ts";

/** The trends job's own name and daily share in the OpenDota budget. */
export const TRENDS_BUDGET = { caller: "trends", dailyCap: 300 } as const;
export const MAX_RUN_CALLS = 40;

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
}

export interface TrendRunResult {
  checked: number;
  cards: number;
  calls: number;
  stopped: "run cap" | "daily budget" | "rate limit" | null;
}

/** OpenDota said 429: the run stops and the rest waits for the next one. */
export class OpenDotaBusy extends Error {}

class Stop extends Error {
  constructor(readonly reason: "run cap" | "daily budget") {
    super(reason);
  }
}

export async function runTrends(deps: TrendDeps, maxCalls = MAX_RUN_CALLS): Promise<TrendRunResult> {
  const result: TrendRunResult = { checked: 0, cards: 0, calls: 0, stopped: null };
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
  return result;
}

async function checkPlayer(player: TrendPlayer, deps: TrendDeps, take: (n: number) => Promise<void>) {
  const stratz = await stratzGamesOf(player, deps);
  await take(1);
  const raw = await deps.fetchRecentMatches(player.account_id);
  if (raw.length === 0 && !stratz.length && Object.keys(player.hero_stats).length > 0) {
    // Games on record but none shown: most likely "Expose public match data" is off.
    return { state: "hidden", games: [], newCard: null, qualifying: [] } satisfies TrendCheck;
  }
  const nowS = deps.nowS();
  const matches = raw.flatMap((r) => {
    const match = readRecentMatch(r);
    return match && isCountedGame(match, nowS) ? [match] : [];
  });
  const benchmarks = await benchmarksFor(matches, stratz, deps, take);
  const games = mergeGames([], stratz, matches.map((match) => ({ match, benchmarks: benchmarks.get(match.heroId) })));
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
    games: games.map((g) => toRow(g, matches, stratz)),
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

/**
 * Benchmarks for the games judged by stats: a known position (STRATZ or lane) but no STRATZ
 * IMP. Cached ones first, then one call each.
 */
async function benchmarksFor(
  matches: RecentMatch[],
  stratz: StratzGame[],
  deps: TrendDeps,
  take: (n: number) => Promise<void>,
) {
  const stratzById = new Map(stratz.map((g) => [g.matchId, g]));
  const needed = matches.filter((m) => {
    const s = stratzById.get(m.matchId);
    if (s && s.heroId === m.heroId && s.imp !== null) return false;
    return (s?.heroId === m.heroId && s.position !== null) || positionFromLane(m) !== null;
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

function toRow(game: TrendGame, matches: RecentMatch[], stratz: CountedStratzGame[]): GameRow {
  const match = matches.find((m) => m.matchId === game.matchId) ??
    stratz.find((g) => g.matchId === game.matchId);
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
