/**
 * Finds the game of a started solo board (a game check-in) for the build-reports job. It looks
 * through the player's own recent games and confirms each candidate with the full match, so a
 * practice draft followed by a real game on one of the same heroes doesn't take the wrong game.
 */
import type { FindDeps, FoundMatch } from "./attach.ts";
import { pickRecentMatches, readMatch } from "./match.ts";

/** Candidate games confirmed per board at most. */
export const CHECK_IN_CANDIDATES = 2;
/** OpenDota calls one board takes at most: the recent games, each candidate, then the parse request. */
export const CHECK_IN_CALLS = 2 + CHECK_IN_CANDIDATES;

/** A board `claim_solo_check_ins` handed out. */
export interface SoloCheckIn {
  id: string;
  account_id: number;
  allies: number[];
  /** The player's own hero, when they picked one of ours. */
  my_hero: number | null;
  started_at: string;
}

export type CheckInFind =
  | { kind: "found"; found: FoundMatch }
  | { kind: "not found" }
  /** OpenDota shows no recent games at all: a hidden profile, or one it hasn't refreshed. */
  | { kind: "no games" };

export async function findCheckInMatch(deps: FindDeps, board: SoloCheckIn): Promise<CheckInFind> {
  const recent = await deps.fetchRecentMatches(board.account_id);
  if (!recent.length) return { kind: "no games" };
  // The player's own hero pins it down; without one, any of our heroes.
  const heroes = board.my_hero ? [board.my_hero] : board.allies;
  for (const candidate of pickRecentMatches(recent, heroes, new Date(board.started_at), CHECK_IN_CANDIDATES)) {
    const match = await deps.fetchMatch(candidate.matchId);
    const side = match && readMatch(match, board.allies);
    if (match && side) return { kind: "found", found: { match, side } };
  }
  return { kind: "not found" };
}
