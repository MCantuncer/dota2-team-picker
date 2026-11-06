/**
 * A player's recent games from STRATZ, which knows the real position and IMP of every
 * ranked game (OpenDota knows the lane only for parsed games, about 1 in 8).
 * Needs a STRATZ_TOKEN; without one the job uses OpenDota alone.
 */
import { MIN_GAME_DURATION_S, type Position, TREND_WINDOW_DAYS } from "./games.ts";
import type { StratzGame } from "./merge.ts";

export const STRATZ_URL = "https://api.stratz.com/graphql";
/** Games asked for per player, like OpenDota's recentMatches. */
export const STRATZ_TAKE = 20;
/** The counted modes (COUNTED_GAME_MODES) by STRATZ name, as Valve's numbers. */
const COUNTED_MODES: Record<string, number> = {
  ALL_PICK: 1,
  CAPTAINS_MODE: 2,
  RANDOM_DRAFT: 3,
  SINGLE_DRAFT: 4,
  ALL_PICK_RANKED: 22,
};
/** Normal and ranked matchmaking (COUNTED_LOBBY_TYPES) by STRATZ name. */
const COUNTED_LOBBIES: Record<string, number> = { UNRANKED: 0, RANKED: 7 };
const POSITIONS = ["POSITION_1", "POSITION_2", "POSITION_3", "POSITION_4", "POSITION_5"];
const DAY_S = 24 * 60 * 60;

/** A counted STRATZ game, with its mode and lobby as Valve's numbers for the saved row. */
export interface CountedStratzGame extends StratzGame {
  gameMode: number;
  lobbyType: number;
}

/** The GraphQL query for one player's recent games, newest first; `skip` pages further back. */
export function playerMatchesQuery(accountId: number, take = STRATZ_TAKE, skip = 0): string {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error(`Bad account id ${accountId}`);
  if (!Number.isSafeInteger(take) || take < 1 || take > 100 || !Number.isSafeInteger(skip) || skip < 0) {
    throw new Error(`Bad page ${take} from ${skip}`);
  }
  return `{ player(steamAccountId: ${accountId}) { matches(request: { take: ${take}, skip: ${skip} }) { ` +
    `id startDateTime durationSeconds gameMode lobbyType ` +
    `players(steamAccountId: ${accountId}) { heroId position isVictory imp leaverStatus } } } }`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Reads the query's `data`. Keeps counted games only (draft modes, normal or ranked, long
 * enough, no leaver, inside the window). Odd rows are skipped, never thrown on.
 */
export function readStratzGames(data: unknown, nowS: number, windowDays = TREND_WINDOW_DAYS): CountedStratzGame[] {
  const player = isObj(data) && isObj(data.player) ? data.player : null;
  const matches = player && Array.isArray(player.matches) ? player.matches : [];
  const since = nowS - windowDays * DAY_S;
  return matches.flatMap((m): CountedStratzGame[] => {
    if (!isObj(m) || !isNum(m.id) || !isNum(m.startDateTime) || !isNum(m.durationSeconds)) return [];
    const p = Array.isArray(m.players) && isObj(m.players[0]) ? m.players[0] : null;
    if (!p || !isNum(p.heroId) || p.heroId <= 0 || typeof p.isVictory !== "boolean") return [];
    const gameMode = COUNTED_MODES[String(m.gameMode)];
    const lobbyType = COUNTED_LOBBIES[String(m.lobbyType)];
    const counted = gameMode !== undefined && lobbyType !== undefined && m.durationSeconds >= MIN_GAME_DURATION_S &&
      m.startDateTime >= since &&
      (p.leaverStatus === undefined || p.leaverStatus === null || p.leaverStatus === "NONE");
    if (!counted) return [];
    const index = POSITIONS.indexOf(String(p.position));
    return [{
      matchId: m.id,
      heroId: p.heroId,
      startTime: m.startDateTime,
      isWin: p.isVictory,
      position: index >= 0 ? (index + 1) as Position : null,
      imp: isNum(p.imp) ? p.imp : null,
      gameMode,
      lobbyType,
    }];
  });
}
