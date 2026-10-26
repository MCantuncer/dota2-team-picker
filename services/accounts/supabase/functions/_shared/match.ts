/**
 * Finds the Dota match a party draft turned into, and whether the party won, from OpenDota.
 * Recent matches of the party's Steam players are searched for one where a player had one of
 * the draft's heroes; a pasted match ID is checked against the draft's heroes instead.
 */

const API = "https://api.opendota.com/api";
/** A match counts if it started at most this long before the draft was opened. */
const EARLY_START_S = 10 * 60;

export interface MatchResult {
  matchId: number;
  won: boolean;
}

interface RecentMatch {
  match_id: number;
  hero_id: number;
  start_time: number;
  player_slot: number;
  radiant_win: boolean | null;
}

interface MatchDetails {
  match_id: number;
  radiant_win?: boolean | null;
  players?: { hero_id: number; player_slot: number }[];
}

/** Slots 0-127 are Radiant, 128 and up Dire. */
const isRadiant = (slot: number) => slot < 128;

/**
 * The first of a player's recent matches that started after the draft and in which they played
 * one of the draft's heroes for our team. Matches without a result yet are skipped.
 */
export function pickRecentMatch(recent: RecentMatch[], allies: number[], draftOpenedAt: Date): MatchResult | null {
  const since = draftOpenedAt.getTime() / 1000 - EARLY_START_S;
  const match = recent
    .filter((m) => m.start_time >= since && allies.includes(m.hero_id) && typeof m.radiant_win === "boolean")
    .sort((a, b) => a.start_time - b.start_time)[0];
  return match ? { matchId: match.match_id, won: isRadiant(match.player_slot) === match.radiant_win } : null;
}

/**
 * The result of a pasted match, if every hero entered for our team played on the same side of
 * it. Null when the heroes don't fit, so a wrong ID never records a result.
 */
export function readMatch(match: MatchDetails, allies: number[]): MatchResult | null {
  if (!allies.length || typeof match.radiant_win !== "boolean" || !match.players) return null;
  const side = (radiant: boolean) =>
    match.players!.filter((p) => isRadiant(p.player_slot) === radiant).map((p) => p.hero_id);
  for (const radiant of [true, false]) {
    if (allies.every((h) => side(radiant).includes(h))) {
      return { matchId: match.match_id, won: radiant === match.radiant_win };
    }
  }
  return null;
}

export async function fetchRecentMatches(accountId: number, fetchFn: typeof fetch = fetch): Promise<RecentMatch[]> {
  const res = await fetchFn(`${API}/players/${accountId}/recentMatches`);
  if (!res.ok) throw new Error(`OpenDota recent matches: HTTP ${res.status}`);
  return ((await res.json()) as RecentMatch[] | null) ?? [];
}

/** The match's details, or null when OpenDota doesn't know it (yet). */
export async function fetchMatch(matchId: number, fetchFn: typeof fetch = fetch): Promise<MatchDetails | null> {
  const res = await fetchFn(`${API}/matches/${matchId}`);
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) throw new Error(`OpenDota match: HTTP ${res.status}`);
  return (await res.json()) as MatchDetails;
}

/**
 * Asks OpenDota to parse the replay now, since replays expire after one to two weeks and the
 * lane numbers for reports need a parsed match. It runs in the background; failures are ignored.
 */
export async function requestParse(matchId: number, fetchFn: typeof fetch = fetch): Promise<void> {
  await fetchFn(`${API}/request/${matchId}`, { method: "POST" })
    .then((res) => res.body?.cancel())
    .catch(() => {});
}
