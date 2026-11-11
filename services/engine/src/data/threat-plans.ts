/**
 * Downloads recent ranked games from the OpenDota explorer and finds the dangerous heroes and their
 * answers (see engine/threat.ts). Runs inside the data refresh once a week.
 */
import { findThreatPlans, type ThreatGame } from "../engine/threat";
import type { Snapshot } from "../engine/types";

/** Days of games to read, newest first, one explorer query per day. */
export const THREAT_DAYS = 10;
/** Games per day: enough for every hero's rarer steps, small enough for one quick query. */
export const GAMES_PER_DAY = 100_000;
/** Fewer games than this (a patch a few days old, an explorer outage) keeps the last plans. */
export const MIN_THREAT_GAMES = 300_000;
/** A hero counts as a position 1 hero for the game length line when this share of his games are there. */
export const POS1_SHARE = 0.7;
export const THREAT_PLANS_MAX_AGE_DAYS = 7;
const DAY_S = 24 * 60 * 60;

/** Whether the plans are missing or older than THREAT_PLANS_MAX_AGE_DAYS. */
export function threatPlansDue(snapshot: Snapshot, now: Date): boolean {
  if (!snapshot.threatPlans) return true;
  return now.getTime() - Date.parse(snapshot.threatPlans.at) >= THREAT_PLANS_MAX_AGE_DAYS * DAY_S * 1000;
}

/** The explorer query for ranked All Pick games over 15 minutes that started in [from, to). */
export function dayQuery(from: number, to: number): string {
  return (
    "select match_id, radiant_win, duration, radiant_team, dire_team from public_matches " +
    `where lobby_type = 7 and game_mode = 22 and duration > 900 and start_time >= ${Math.floor(from)} and start_time < ${Math.floor(to)} ` +
    `order by match_id desc limit ${GAMES_PER_DAY}`
  );
}

const isTeam = (x: unknown): x is number[] => Array.isArray(x) && x.length === 5 && x.every((h) => Number.isSafeInteger(h) && h > 0);

/** The explorer's rows as games; rows with a missing or odd field are left out. */
export function toThreatGames(rows: unknown): ThreatGame[] {
  if (!Array.isArray(rows)) throw new Error("Explorer answer has no rows");
  const out: ThreatGame[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const { match_id: id, radiant_win: win, duration, radiant_team: radiant, dire_team: dire } = row ?? {};
    if (!Number.isSafeInteger(id) || typeof win !== "boolean" || typeof duration !== "number" || !isTeam(radiant) || !isTeam(dire)) continue;
    out.push({ id: id as number, radiantWin: win, minutes: duration / 60, radiant, dire });
  }
  return out;
}

/** Heroes with at least POS1_SHARE of their games at position 1, from the STRATZ positions. */
export function positionOneHeroes(positions: Snapshot["positions"] = {}): Set<number> {
  const out = new Set<number>();
  for (const [hero, games] of Object.entries(positions)) {
    const total = games.reduce((a, b) => a + b, 0);
    if (total > 0 && (games[0] ?? 0) / total >= POS1_SHARE) out.add(Number(hero));
  }
  return out;
}

/**
 * Reads THREAT_DAYS days of games (never from before the patch) and saves the plans in the snapshot.
 * Throws, keeping the last plans, when the explorer fails or returns too few games.
 */
export async function fetchThreatPlans(
  snapshot: Snapshot,
  get: <T>(path: string) => Promise<T>,
  now: Date,
  patchStart: number,
): Promise<void> {
  const nowS = now.getTime() / 1000;
  const games: ThreatGame[] = [];
  for (let day = 0; day < THREAT_DAYS; day++) {
    const to = nowS - day * DAY_S;
    const from = Math.max(to - DAY_S, patchStart);
    if (from >= to) break;
    const answer = await get<{ rows?: unknown; err?: unknown }>(`/explorer?sql=${encodeURIComponent(dayQuery(from, to))}`);
    if (answer.err) throw new Error(`Explorer query failed: ${String(answer.err)}`);
    games.push(...toThreatGames(answer.rows));
  }
  if (games.length < MIN_THREAT_GAMES) throw new Error(`Threat plans: only ${games.length} games, expected ${MIN_THREAT_GAMES}+`);
  const { plans, groupLength } = findThreatPlans(games, positionOneHeroes(snapshot.positions));
  snapshot.threatPlans = { at: now.toISOString(), games: games.length, plans, pos1Length: groupLength };
}
