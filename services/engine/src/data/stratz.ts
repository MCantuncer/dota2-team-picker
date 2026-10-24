/**
 * Games per position (1-5) for every hero from the STRATZ API, which detects
 * each player's real position. OpenDota only knows the lane, so it cannot tell
 * a roaming pos 4 from a mid or a pos 5 from a carry.
 *
 * Needs a free API token (stratz.com/api) in STRATZ_TOKEN.
 */
import type { Snapshot } from "../engine/types";

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
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // STRATZ asks API clients to send this user agent.
      "User-Agent": "STRATZ_API",
    },
    body: JSON.stringify({ query: POSITIONS_QUERY }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { heroStats?: Record<string, WinRow[]> };
    errors?: { message: string }[];
  };
  if (!res.ok || body.errors?.length || !body.data?.heroStats) {
    const why = body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`STRATZ positions failed: ${why}`);
  }
  return toPositions(body.data.heroStats);
}
