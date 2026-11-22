/**
 * The match details behind Similar Games, from STRATZ, 20 matches per query: for every player the hero, side,
 * position, lane, kills, deaths, assists, net worth, last hits by 10 minutes, the first buy of each item and every
 * death with its attacker. Field names checked against a real STRATZ answer (fixtures/stratz-matches.json,
 * 2026-11-22). The Steam account is kept only so one player can't fill a sample; it never leaves the function.
 */

/** Matches per STRATZ query. */
export const MATCHES_PER_QUERY = 20;
/** Changes when the stored shape changes, so older rows are fetched again. */
export const DETAILS_VERSION = 1;

const POSITIONS = ["POSITION_1", "POSITION_2", "POSITION_3", "POSITION_4", "POSITION_5"];
const LANES: Record<string, Lane> = { SAFE_LANE: "safe", MID_LANE: "mid", OFF_LANE: "off", JUNGLE: "jungle" };

export type Lane = "safe" | "mid" | "off" | "jungle";

export interface SimilarPlayer {
  hero: number;
  radiant: boolean;
  /** 1 to 5, or null when STRATZ has none. */
  position: number | null;
  /** Null when STRATZ has none, or the player roamed. */
  lane: Lane | null;
  /** Steam account id, null when anonymous. Never sent to the browser. */
  account: number | null;
  kills: number;
  deaths: number;
  assists: number;
  networth: number;
  /** Last hits by the end of minute 10, null when the game was shorter or STRATZ has no minutes. */
  lastHits10: number | null;
  /** The first buy of each item: [item id, seconds from the horn], in buy order. Starting items are negative. */
  buys: [number, number][];
  /** Each death: [seconds from the horn, attacker hero id or null when not a hero]. */
  deathsAt: [number, number | null][];
}

export interface SimilarMatch {
  version: number;
  match: number;
  /** Seconds. */
  duration: number;
  radiantWon: boolean;
  players: SimilarPlayer[];
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** One query for up to MATCHES_PER_QUERY matches. */
export function detailsQuery(ids: number[]): string {
  if (ids.length === 0 || ids.length > MATCHES_PER_QUERY || !ids.every(isId)) {
    throw new Error(`Expected 1 to ${MATCHES_PER_QUERY} match ids, got ${ids.length}`);
  }
  const lines = ids.map((id, i) =>
    `  m${i}: match(id: ${id}) { id durationSeconds didRadiantWin players { steamAccountId heroId isRadiant position lane kills deaths assists networth stats { lastHitsPerMinute deathEvents { time attacker } itemPurchases { time itemId } } } }`
  );
  return `{\n${lines.join("\n")}\n}`;
}

/** The answer's matches, by id, read with toSimilarMatch; matches STRATZ doesn't have or can't give in full are left out. */
export function readDetails(answer: unknown): SimilarMatch[] {
  if (!answer || typeof answer !== "object") return [];
  return Object.values(answer).map(toSimilarMatch).filter((m): m is SimilarMatch => m !== null);
}

/**
 * One match of a STRATZ answer, or null when a field is missing: a match without ten players with stats
 * (STRATZ hasn't parsed it) can't say who bought what or died when, so it is not used.
 */
export function toSimilarMatch(answer: unknown): SimilarMatch | null {
  // Checked field by field below.
  const m = answer as { id?: unknown; durationSeconds?: unknown; didRadiantWin?: unknown; players?: unknown } | null;
  if (!m || !isId(m.id) || !isId(m.durationSeconds) || typeof m.didRadiantWin !== "boolean") return null;
  if (!Array.isArray(m.players) || m.players.length !== 10) return null;
  const players = m.players.map(toPlayer);
  if (!players.every((p): p is SimilarPlayer => p !== null)) return null;
  if (new Set(players.map((p) => p.hero)).size !== 10 || players.filter((p) => p.radiant).length !== 5) return null;
  return { version: DETAILS_VERSION, match: m.id, duration: m.durationSeconds, radiantWon: m.didRadiantWin, players };
}

function toPlayer(answer: unknown): SimilarPlayer | null {
  // Checked field by field below.
  const p = answer as {
    steamAccountId?: unknown;
    heroId?: unknown;
    isRadiant?: unknown;
    position?: unknown;
    lane?: unknown;
    kills?: unknown;
    deaths?: unknown;
    assists?: unknown;
    networth?: unknown;
    stats?: { lastHitsPerMinute?: unknown; deathEvents?: unknown; itemPurchases?: unknown } | null;
  } | null;
  if (!p || !isId(p.heroId) || typeof p.isRadiant !== "boolean" || !p.stats) return null;
  if (!isCount(p.kills) || !isCount(p.deaths) || !isCount(p.assists) || !isCount(p.networth)) return null;
  const { lastHitsPerMinute, deathEvents, itemPurchases } = p.stats;
  if (!Array.isArray(deathEvents) || !Array.isArray(itemPurchases)) return null;
  const deathsAt = deathEvents.map((d): [number, number | null] | null =>
    isTime(d?.time) ? [d.time, isId(d?.attacker) ? d.attacker : null] : null
  );
  if (!deathsAt.every((d) => d !== null)) return null;
  const buys: [number, number][] = [];
  const seen = new Set<number>();
  for (const b of [...itemPurchases].sort((a, b) => (a?.time ?? 0) - (b?.time ?? 0))) {
    // A purchase STRATZ can't name (item 0, as with items new this patch) is left out; the rest still count.
    if (!isId(b?.itemId) || !isTime(b?.time) || seen.has(b.itemId)) continue;
    seen.add(b.itemId);
    buys.push([b.itemId, b.time]);
  }
  const position = POSITIONS.indexOf(String(p.position)) + 1;
  // STRATZ counts last hits per minute, minute 0 first; by the end of minute 10 is the sum of the first ten.
  const perMinute = Array.isArray(lastHitsPerMinute) && lastHitsPerMinute.every(isCount)
    ? lastHitsPerMinute as number[]
    : [];
  return {
    hero: p.heroId,
    radiant: p.isRadiant,
    position: position > 0 ? position : null,
    lane: LANES[String(p.lane)] ?? null,
    account: isId(p.steamAccountId) ? p.steamAccountId : null,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    networth: p.networth,
    lastHits10: perMinute.length >= 10 ? perMinute.slice(0, 10).reduce((a, b) => a + b, 0) : null,
    buys,
    deathsAt: (deathsAt as [number, number | null][]).sort((a, b) => a[0] - b[0]),
  };
}
