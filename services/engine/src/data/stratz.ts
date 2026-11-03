/**
 * Games per position (1-5) for every hero from the STRATZ API, which detects
 * each player's real position. OpenDota only knows the lane, so it cannot tell
 * a roaming pos 4 from a mid or a pos 5 from a carry.
 *
 * Needs a free API token (stratz.com/api) in STRATZ_TOKEN.
 */
import type { Position, Snapshot } from "../engine/types";

const URL = "https://api.stratz.com/graphql";
const POSITIONS = ["POSITION_1", "POSITION_2", "POSITION_3", "POSITION_4", "POSITION_5"] as const;

interface WinRow {
  heroId: number;
  matchCount: number;
}

/** One query with an alias per position, each over the latest week of ranked games. */
export const POSITIONS_QUERY = `{
  heroStats {
${POSITIONS.map((p, i) => `    pos${i + 1}: winWeek(take: 1, positionIds: [${p}]) { heroId matchCount }`).join("\n")}
  }
}`;

/** Turns the per-position rows into games per position for each hero. */
export function toPositions(data: Record<string, WinRow[]>): NonNullable<Snapshot["positions"]> {
  const out: NonNullable<Snapshot["positions"]> = {};
  POSITIONS.forEach((_, i) => {
    for (const row of data[`pos${i + 1}`] ?? []) {
      const games = (out[row.heroId] ??= [0, 0, 0, 0, 0]);
      games[i]! += row.matchCount;
    }
  });
  return out;
}

export async function fetchPositions(token: string): Promise<NonNullable<Snapshot["positions"]>> {
  const data = await postStratz<{ heroStats?: Record<string, WinRow[]> }>(token, POSITIONS_QUERY, "positions");
  if (!data.heroStats) throw new Error("STRATZ positions failed: no heroStats in the answer");
  return toPositions(data.heroStats);
}

/** Matches asked for in one query. */
export const MATCHES_PER_QUERY = 10;

/**
 * Asks for the detected position of every player in up to MATCHES_PER_QUERY matches, one
 * aliased `match(id:)` each. The `matches(ids:)` list query is for STRATZ admins only.
 */
export function matchPositionsQuery(ids: number[]): string {
  if (ids.length === 0 || ids.length > MATCHES_PER_QUERY || !ids.every(Number.isSafeInteger)) {
    throw new Error(`Expected 1 to ${MATCHES_PER_QUERY} match ids, got ${ids.length}`);
  }
  return `{ ${ids.map((id, i) => `m${i}: match(id: ${id}) { id players { heroId position } }`).join(" ")} }`;
}

interface MatchPlayersRow {
  id?: unknown;
  players?: { heroId?: unknown; position?: unknown }[] | null;
}

/**
 * Turns the answer into position (1-5) by hero id for each match. Players STRATZ could
 * not place (UNKNOWN, FILTERED, missing) are left out, so a match may have fewer than 10.
 */
export function toMatchPositions(rows: (MatchPlayersRow | null | undefined)[]): Map<number, Map<number, Position>> {
  const out = new Map<number, Map<number, Position>>();
  for (const row of rows) {
    if (typeof row?.id !== "number") continue;
    const byHero = new Map<number, Position>();
    for (const p of row.players ?? []) {
      const position = POSITIONS.indexOf(p.position as (typeof POSITIONS)[number]) + 1;
      if (typeof p.heroId === "number" && position > 0) byHero.set(p.heroId, position as Position);
    }
    out.set(row.id, byHero);
  }
  return out;
}

/**
 * Positions by hero for each match id, fetched MATCHES_PER_QUERY at a time. A batch STRATZ
 * refuses (for example a game it has not seen yet) is skipped with a warning and asked again on a
 * later run; when every batch fails, the call throws.
 */
export async function fetchMatchPositions(token: string, ids: number[]): Promise<Map<number, Map<number, Position>>> {
  const out = new Map<number, Map<number, Position>>();
  const failures: string[] = [];
  for (let i = 0; i < ids.length; i += MATCHES_PER_QUERY) {
    const batch = ids.slice(i, i + MATCHES_PER_QUERY);
    try {
      const data = await postStratz<Record<string, MatchPlayersRow | null>>(token, matchPositionsQuery(batch), "match positions");
      for (const [id, positions] of toMatchPositions(Object.values(data))) out.set(id, positions);
    } catch (err) {
      failures.push((err as Error).message);
    }
  }
  const batches = Math.ceil(ids.length / MATCHES_PER_QUERY);
  if (batches > 0 && failures.length === batches) throw new Error(failures[0]);
  for (const f of new Set(failures)) console.warn(`::warning::${f} (skipped one batch of games)`);
  return out;
}

/** Tries per query when STRATZ answers 429 (too many requests). */
const RATE_LIMIT_ATTEMPTS = 4;
/** First wait after a 429 when STRATZ does not say how long; doubles each time. */
const RATE_LIMIT_WAIT_MS = 5_000;

/**
 * POSTs a GraphQL query and returns its `data`. A 429 is retried after the wait STRATZ gives in
 * Retry-After (or 5s, 10s, 20s). Throws on other HTTP or GraphQL errors, or when the retries run out.
 */
export async function postStratz<T>(token: string, query: string, what: string, sleep = wait): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // STRATZ asks API clients to send this user agent.
        "User-Agent": "STRATZ_API",
      },
      body: JSON.stringify({ query }),
    });
    if (res.status === 429 && attempt < RATE_LIMIT_ATTEMPTS) {
      const seconds = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_WAIT_MS * 2 ** (attempt - 1));
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as { data?: T | null; errors?: { message: string }[] };
    if (!res.ok || body.errors?.length || !body.data) {
      const why = body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
      throw new Error(`STRATZ ${what} failed: ${why}`);
    }
    return body.data;
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
