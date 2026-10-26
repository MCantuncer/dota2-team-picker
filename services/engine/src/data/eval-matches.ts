/**
 * Real ranked games saved for the engine backtest: the order heroes were picked in,
 * the bans, each player's position and who won. Kept apart from the snapshot so the
 * backtest can score the engine on games it never learned from.
 */
import type { PublicMatch } from "./fetch";
import type { Position } from "../engine/types";

/** One saved ranked All Pick game. */
export interface EvalMatch {
  id: number;
  /** Unix seconds. */
  startTime: number;
  /** Average OpenDota rank tier of the ranked players (54 = Legend 4), when known. */
  rankTier: number | null;
  radiantWin: boolean;
  /** All 10 picks in the order they were made. `position` is null when STRATZ could not tell. */
  picks: { heroId: number; radiant: boolean; position: Position | null }[];
  /** Banned heroes. In ranked All Pick every ban is known before the first pick. */
  bans: number[];
}

/** The parts of OpenDota's /matches/{id} answer the backtest uses. */
export interface MatchDetail {
  match_id: number;
  radiant_win: boolean;
  duration: number;
  game_mode: number;
  lobby_type: number;
  start_time: number;
  picks_bans?: { is_pick: boolean; hero_id: number; team: number; order: number }[] | null;
}

const RANKED_ALL_PICK = 22;
const RANKED_LOBBY = 7;
const MIN_DURATION_S = 15 * 60;

/** True for a finished ranked All Pick game with all 10 heroes known: worth asking OpenDota about. */
export function isCandidate(m: PublicMatch): boolean {
  return (
    m.game_mode === RANKED_ALL_PICK &&
    m.lobby_type === RANKED_LOBBY &&
    m.duration >= MIN_DURATION_S &&
    [m.radiant_team, m.dire_team].every((t) => t?.length === 5 && !t.includes(0))
  );
}

/**
 * Builds an EvalMatch from OpenDota's match details and STRATZ positions (hero id to
 * position). Returns null when the answer is not a complete ranked draft: wrong mode,
 * too short, or picks that are missing, repeated or not 5 a side.
 */
export function toEvalMatch(
  detail: MatchDetail,
  rankTier: number | null,
  positions: Map<number, Position> | undefined,
): EvalMatch | null {
  if (detail.game_mode !== RANKED_ALL_PICK || detail.lobby_type !== RANKED_LOBBY) return null;
  if (detail.duration < MIN_DURATION_S || typeof detail.radiant_win !== "boolean") return null;
  const rows = Array.isArray(detail.picks_bans) ? detail.picks_bans : [];
  const valid = rows.filter((r) => Number.isInteger(r.hero_id) && r.hero_id > 0 && (r.team === 0 || r.team === 1));
  const picks = valid
    .filter((r) => r.is_pick)
    .sort((a, b) => a.order - b.order)
    .map((r) => ({ heroId: r.hero_id, radiant: r.team === 0, position: positions?.get(r.hero_id) ?? null }));
  const heroes = new Set(picks.map((p) => p.heroId));
  if (picks.length !== 10 || heroes.size !== 10 || picks.filter((p) => p.radiant).length !== 5) return null;
  const bans = [...new Set(valid.filter((r) => !r.is_pick).map((r) => r.hero_id))].filter((id) => !heroes.has(id));
  return { id: detail.match_id, startTime: detail.start_time, rankTier, radiantWin: detail.radiant_win, picks, bans };
}

/** Storage path for the month a match started in, such as `eval/matches-2026-10.json`. */
export function monthPath(startTime: number): string {
  return `eval/matches-${new Date(startTime * 1000).toISOString().slice(0, 7)}.json`;
}

/** Adds new matches to saved ones, skipping ids already saved, oldest first. */
export function mergeMatches(saved: EvalMatch[], added: EvalMatch[]): EvalMatch[] {
  const byId = new Map(saved.map((m) => [m.id, m]));
  for (const m of added) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.startTime - b.startTime || a.id - b.id);
}
