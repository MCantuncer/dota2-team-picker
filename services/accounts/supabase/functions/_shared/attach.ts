/**
 * Finds the match a party draft turned into and attaches it, for both the after-game card
 * (draft-result) and the report job. A match is attached only after every hero entered for
 * our team is confirmed on one side of it, so a solo game on one of the same heroes never
 * gets attached by mistake.
 */
import { type MatchDetails, pickRecentMatch, readMatch, sidePlayers, type SideResult } from "./match.ts";

/** OpenDota calls `findDraftMatch` makes at most: each player's recent games, then the match. */
export const findCalls = (steamPlayers: number) => steamPlayers + 1;

export interface FindDeps {
  fetchRecentMatches: (accountId: number) => Promise<Parameters<typeof pickRecentMatch>[0]>;
  fetchMatch: (matchId: number) => Promise<MatchDetails | null>;
}

export interface FoundMatch {
  match: MatchDetails;
  side: SideResult;
}

/**
 * Looks through the players' recent games for the first one after the draft opened with one
 * of our heroes, then confirms it with the full match. Null when nothing is found or the
 * candidate doesn't hold all our heroes.
 */
export async function findDraftMatch(
  deps: FindDeps,
  accountIds: number[],
  allies: number[],
  openedAt: Date,
): Promise<FoundMatch | null> {
  for (const accountId of accountIds) {
    const candidate = pickRecentMatch(await deps.fetchRecentMatches(accountId), allies, openedAt);
    if (!candidate) continue;
    const match = await deps.fetchMatch(candidate.matchId);
    const side = match && readMatch(match, allies);
    return match && side ? { match, side } : null;
  }
  return null;
}

/** The part of a Supabase client `attachMatch` needs, so tests can pass a stand-in. */
export interface AttachClient {
  rpc(fn: "attach_draft_match", args: {
    draft: string;
    match: number;
    did_win: boolean;
    our_players: { account_id: number | null; hero_id: number }[];
    mode: number | null;
    lobby: number | null;
  }): PromiseLike<{ data: boolean | null; error: unknown }>;
}

/**
 * Saves the match on the draft with who played which hero, and queues its report. Returns
 * false when another caller attached a match first. Throws on a database error.
 */
export async function attachMatch(client: AttachClient, draftId: string, found: FoundMatch): Promise<boolean> {
  const { data, error } = await client.rpc("attach_draft_match", {
    draft: draftId,
    match: found.side.matchId,
    did_win: found.side.won,
    our_players: sidePlayers(found.match, found.side.isRadiant),
    mode: found.match.game_mode ?? null,
    lobby: found.match.lobby_type ?? null,
  });
  if (error || data === null) throw new Error(`Attaching the match failed: ${JSON.stringify(error ?? "no result")}`);
  return data;
}
