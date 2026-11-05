/**
 * One refresh-trends step for one of a player's games: read the match from OpenDota, build its
 * GameSummary, and say what to save in player_game_facts. Network and database parts come in
 * as `deps`, so the rules are tested without them.
 *
 * - Parsed: saved as `parsed` for good.
 * - Not parsed: the basic summary is saved now (the page shows the basic numbers meanwhile)
 *   and a parse is asked for, at most MAX_PARSE_REQUESTS times with growing gaps. A day after
 *   the row was made, or for a game older than PARSE_MAX_AGE_DAYS (its replay is gone), it
 *   stays `basic` for good.
 * - An error: counted and retried after a growing gap; after MAX_ERRORS in a row the job
 *   stops trying and the row goes when it is 60 days old. A new game whose match can't be
 *   read yet saves nothing, so it is simply tried again next run.
 * - Budget refusals and OpenDota rate limiting are thrown on, so the run stops.
 */
import { MAX_ERRORS, MAX_PARSE_REQUESTS, PARSE_WAIT_MS, retryGapMs } from "../report/build.ts";
import { type Match, readOpenDotaMatch } from "../report/match.ts";
import type { Position } from "../trends/games.ts";
import type { Finding } from "./findings.ts";
import { type GameSummary, SUMMARY_VERSION } from "./summary.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Games kept in player_game_facts (and on the "Your Games" page). */
export const KEEP_DAYS = 60;
/** Replays expire after one to two weeks: older games are only read, never parsed. */
export const PARSE_MAX_AGE_DAYS = 14;
/** Newest counted games per player that get a row: the first backfill reads the last 20. */
export const MAX_GAMES_PER_PLAYER = 20;
/** New games this old or newer get a row; past PARSE_MAX_AGE_DAYS they are read but not parsed. */
export const NEW_GAME_DAYS = 30;
const ERROR_MAX_CHARS = 500;

/** A game the job works on: a row already in player_game_facts, or a new one from player_games. */
export interface FactItem {
  user_id: string;
  /** The player's Steam account id (32 bit), to find them in the match. */
  account_id: number;
  match_id: number;
  hero_id: number;
  position: Position | null;
  is_win: boolean;
  started_at: string;
  /** The rest is null (or 0) for a game with no row yet. */
  created_at: string | null;
  duration_s: number | null;
  /** The saved summary, kept as it is when a later try fails. */
  summary: unknown;
  summary_version: number | null;
  parse_requests: number;
  parse_requested_at: string | null;
  attempts: number;
}

/** A player_game_facts row to upsert on (user_id, match_id). */
export interface FactRow {
  user_id: string;
  match_id: number;
  hero_id: number;
  position: Position | null;
  is_win: boolean;
  started_at: string;
  duration_s: number;
  status: "waiting_parse" | "parsed" | "basic";
  /** A GameSummary, or (after a failed try) whatever summary the row already had. */
  summary: GameSummary | unknown;
  summary_version: number | null;
  parse_requests: number;
  parse_requested_at: string | null;
  attempts: number;
  error: string | null;
  next_try_at: string;
  /** This game's strengths and problems; left out after a failed try, so the saved ones stay. */
  findings?: Finding[];
}

export interface FactDeps {
  /** Takes calls from the run's budget; throws to stop the run when refused. */
  take: (n: number) => Promise<void>;
  /** The raw `GET /matches/{id}` response, or null when OpenDota doesn't know the match. */
  fetchMatch: (matchId: number) => Promise<unknown | null>;
  requestParse: (matchId: number) => Promise<void>;
  /** The player's summary, or null when their account isn't in the match. */
  summarize: (match: Match, item: FactItem) => GameSummary | null;
  /** The game's strengths and problems (gameFindings). */
  findingsOf: (summary: GameSummary) => Finding[];
  now: Date;
}

/** Thrown on from buildFact: the budget or OpenDota said stop. */
export type IsStop = (err: unknown) => boolean;

/** The row to save for this game, or null when there is nothing to save yet. */
export async function buildFact(item: FactItem, deps: FactDeps, isStop: IsStop): Promise<FactRow | null> {
  const now = deps.now.getTime();
  const at = (ms: number) => new Date(ms).toISOString();
  const createdAt = item.created_at === null ? now : Date.parse(item.created_at);
  let durationS: number | null = null;

  try {
    await deps.take(1);
    const raw = await deps.fetchMatch(item.match_id);
    if (raw === null) throw new Error("OpenDota doesn't have the match yet");
    const match = readOpenDotaMatch(raw);
    durationS = match.durationS;
    const summary = deps.summarize(match, item);
    if (!summary) throw new Error("The player's account is not in the match");
    const base = {
      ...rowOf(item, match.durationS),
      summary,
      summary_version: SUMMARY_VERSION,
      findings: deps.findingsOf(summary),
      parse_requests: item.parse_requests,
      parse_requested_at: item.parse_requested_at,
      attempts: 0,
      error: null,
    };

    if (match.isParsed) return { ...base, status: "parsed", next_try_at: at(now) };

    const tooOld = now - Date.parse(item.started_at) >= PARSE_MAX_AGE_DAYS * DAY_MS;
    const giveUpAt = createdAt + PARSE_WAIT_MS;
    if (tooOld || (item.parse_requests >= MAX_PARSE_REQUESTS && now >= giveUpAt)) {
      return { ...base, status: "basic", next_try_at: at(now) };
    }
    if (item.parse_requests >= MAX_PARSE_REQUESTS) {
      return { ...base, status: "waiting_parse", next_try_at: at(giveUpAt) };
    }

    let requests = item.parse_requests;
    let requestedAt = item.parse_requested_at === null ? null : Date.parse(item.parse_requested_at);
    if (requestedAt === null || now - requestedAt >= retryGapMs(requests - 1)) {
      await deps.take(1);
      await deps.requestParse(item.match_id);
      requests += 1;
      requestedAt = now;
    }
    return {
      ...base,
      status: "waiting_parse",
      parse_requests: requests,
      parse_requested_at: at(requestedAt),
      next_try_at: at(requestedAt + retryGapMs(requests - 1)),
    };
  } catch (err) {
    if (isStop(err)) throw err;
    return failure(item, err, durationS, now);
  }
}

function rowOf(item: FactItem, durationS: number) {
  return {
    user_id: item.user_id,
    match_id: item.match_id,
    hero_id: item.hero_id,
    position: item.position,
    is_win: item.is_win,
    started_at: item.started_at,
    duration_s: durationS,
  };
}

/**
 * An error: an existing row counts it and waits; a new game with a readable match gets a row
 * that waits the same way. A new game whose match couldn't be read saves nothing.
 */
function failure(item: FactItem, err: unknown, durationS: number | null, now: number): FactRow | null {
  const duration = durationS ?? item.duration_s;
  if (duration === null) return null;
  const attempts = item.attempts + 1;
  const message = err instanceof Error ? err.message : String(err);
  const giveUp = attempts >= MAX_ERRORS;
  // After the last error, wait until the row is removed at KEEP_DAYS.
  const nextTry = giveUp ? Date.parse(item.started_at) + KEEP_DAYS * DAY_MS : now + retryGapMs(attempts - 1);
  return {
    ...rowOf(item, duration),
    status: "waiting_parse",
    summary: item.summary_version === null ? null : item.summary,
    summary_version: item.summary_version,
    parse_requests: item.parse_requests,
    parse_requested_at: item.parse_requested_at,
    attempts,
    error: message.slice(0, ERROR_MAX_CHARS),
    next_try_at: new Date(nextTry).toISOString(),
  };
}

/** A counted game from player_games, with the player's Steam account. */
export type NewGame = Pick<
  FactItem,
  "user_id" | "account_id" | "match_id" | "hero_id" | "position" | "is_win" | "started_at"
>;

/**
 * Picks which games get a row: per player, the newest MAX_GAMES_PER_PLAYER counted games
 * started in the last NEW_GAME_DAYS that have none yet, newest first.
 */
export function pickNewGames(
  games: NewGame[],
  hasRow: (userId: string, matchId: number) => boolean,
  now: Date,
): FactItem[] {
  const since = now.getTime() - NEW_GAME_DAYS * DAY_MS;
  const byUser = new Map<string, typeof games>();
  for (const g of games) {
    if (Date.parse(g.started_at) < since) continue;
    byUser.set(g.user_id, [...(byUser.get(g.user_id) ?? []), g]);
  }
  const picked: FactItem[] = [];
  for (const list of byUser.values()) {
    list.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    for (const g of list.slice(0, MAX_GAMES_PER_PLAYER)) {
      if (hasRow(g.user_id, g.match_id)) continue;
      picked.push({
        ...g,
        created_at: null,
        duration_s: null,
        summary: null,
        summary_version: null,
        parse_requests: 0,
        parse_requested_at: null,
        attempts: 0,
      });
    }
  }
  return picked.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPosition = (v: unknown): v is Position => isNum(v) && Number.isInteger(v) && v >= 1 && v <= 5;
/** An embedded relation comes back as an object or a one item list, depending on the key. */
const one = (v: unknown): Obj | null => (Array.isArray(v) ? (isObj(v[0]) ? v[0] : null) : isObj(v) ? v : null);
const STEAM_ID_BASE = 76561197960265728n;

/** The 32 bit account id for a 64 bit Steam id, or null when it isn't one. */
export function accountIdOf(steamId: unknown): number | null {
  if (typeof steamId !== "string" || !/^\d{17}$/.test(steamId)) return null;
  const id = BigInt(steamId) - STEAM_ID_BASE;
  return id > 0n && id < 2n ** 32n ? Number(id) : null;
}

/** The columns both readers need, with the player's Steam id from `profiles!inner(steam_id)`. */
function readGame(row: unknown): NewGame | null {
  if (!isObj(row) || typeof row.user_id !== "string" || typeof row.started_at !== "string") return null;
  if (!isNum(row.match_id) || !isNum(row.hero_id) || typeof row.is_win !== "boolean") return null;
  const accountId = accountIdOf(one(row.profiles)?.steam_id);
  if (accountId === null) return null;
  return {
    user_id: row.user_id,
    account_id: accountId,
    match_id: row.match_id,
    hero_id: row.hero_id,
    position: isPosition(row.position) ? row.position : null,
    is_win: row.is_win,
    started_at: row.started_at,
  };
}

/** The select for player_games rows that may need a feedback row. */
export const NEW_GAMES_SELECT = "user_id, match_id, hero_id, position, is_win, started_at, profiles!inner(steam_id)";
/** The select for player_game_facts rows waiting for a parse. */
export const DUE_ROWS_SELECT =
  "user_id, match_id, hero_id, position, is_win, started_at, created_at, duration_s, summary, summary_version, " +
  "parse_requests, parse_requested_at, attempts, profiles!inner(steam_id)";

/** Reads player_games rows; rows without a linked Steam account or with odd values are skipped. */
export function readNewGames(rows: unknown): NewGame[] {
  return Array.isArray(rows) ? rows.flatMap((r) => readGame(r) ?? []) : [];
}

/** Reads due player_game_facts rows the same way. */
export function readDueRows(rows: unknown): FactItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): FactItem[] => {
    const game = readGame(row);
    if (!game || !isObj(row) || typeof row.created_at !== "string" || !isNum(row.duration_s)) return [];
    return [{
      ...game,
      created_at: row.created_at,
      duration_s: row.duration_s,
      summary: row.summary ?? null,
      summary_version: isNum(row.summary_version) ? row.summary_version : null,
      parse_requests: isNum(row.parse_requests) ? row.parse_requests : 0,
      parse_requested_at: typeof row.parse_requested_at === "string" ? row.parse_requested_at : null,
      attempts: isNum(row.attempts) ? row.attempts : 0,
    }];
  });
}
