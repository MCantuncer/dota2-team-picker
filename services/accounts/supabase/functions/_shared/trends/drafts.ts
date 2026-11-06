/**
 * The player's games from our own party drafts, a third source of positions after STRATZ
 * and OpenDota lanes. Only drafts where the hero came from the player's account in the match
 * (hero_source 'account'), with a found match, a result and a planned position.
 */
import { COUNTED_GAME_MODES, COUNTED_LOBBY_TYPES, type Position, TREND_WINDOW_DAYS } from "./games.ts";
import type { DraftGame } from "./merge.ts";

const DAY_S = 24 * 60 * 60;

/** A counted draft game, with its mode and lobby for the saved row. */
export interface CountedDraftGame extends DraftGame {
  gameMode: number;
  lobbyType: number;
}

/** The select for draft_players, read with the service role. */
export const DRAFT_GAMES_SELECT =
  "hero_id, position, party_drafts!inner(match_id, won, ended_at, match_reports(game_mode, lobby_type))";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** An embedded relation comes back as an object or a one item list, depending on the key. */
const one = (v: unknown): Obj | null => (Array.isArray(v) ? (isObj(v[0]) ? v[0] : null) : isObj(v) ? v : null);

/** Reads the rows into counted draft games inside the window. Odd rows are skipped. */
export function readDraftGames(rows: unknown, nowS: number, windowDays = TREND_WINDOW_DAYS): CountedDraftGame[] {
  if (!Array.isArray(rows)) return [];
  const since = nowS - windowDays * DAY_S;
  return rows.flatMap((row): CountedDraftGame[] => {
    if (!isObj(row) || !isNum(row.hero_id) || row.hero_id <= 0 || !isNum(row.position)) return [];
    if (row.position < 1 || row.position > 5) return [];
    const draft = one(row.party_drafts);
    if (!draft || !isNum(draft.match_id) || typeof draft.won !== "boolean" || typeof draft.ended_at !== "string") {
      return [];
    }
    const startTime = Date.parse(draft.ended_at) / 1000;
    const report = one(draft.match_reports);
    const gameMode = report?.game_mode;
    const lobbyType = report?.lobby_type;
    const counted = Number.isFinite(startTime) && startTime >= since &&
      isNum(gameMode) && COUNTED_GAME_MODES.includes(gameMode) && isNum(lobbyType) &&
      COUNTED_LOBBY_TYPES.includes(lobbyType);
    if (!counted) return [];
    return [{
      matchId: draft.match_id,
      heroId: row.hero_id,
      startTime,
      isWin: draft.won,
      position: row.position as Position,
      gameMode,
      lobbyType,
    }];
  });
}
