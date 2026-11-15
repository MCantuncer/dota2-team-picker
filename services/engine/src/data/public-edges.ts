/**
 * Draft edges of fair public ranked games, for the win range. Each UTC day gets one OpenDota
 * explorer query for a sample of that day's ranked All Pick games, scored with the hero data copy
 * of the day before (what the site showed then, so nothing from the game's own day leaks in).
 * Only Radiant's edge and the result are kept, for the last EDGE_DAYS days.
 */
import { bracketOf } from "../backtest/backtest";
import { Engine } from "../engine/score";
import type { Snapshot } from "../engine/types";
import { draftEdge } from "../engine/win-chance";

/** Days of games kept and fitted on. */
export const EDGE_DAYS = 21;
/** One game in this many per day: about 4,000 of the ~480,000 ranked All Pick games a day. */
export const EDGE_SAMPLE_EVERY = 120;
const EDGE_ROWS = 6000;
const QUERY_ATTEMPTS = 2;
const DAY_S = 24 * 60 * 60;

/** Radiant's edge (one decimal) and 1 when Radiant won, per game, by UTC day ("2026-11-14"). */
export type EdgeDays = Record<string, [number, 0 | 1][]>;

export interface EdgeStore {
  load(): Promise<EdgeDays>;
  save(days: EdgeDays): Promise<void>;
}

export interface EdgeDeps {
  store: EdgeStore;
  openDota: <T>(path: string) => Promise<T>;
  /** The hero data copy at a bucket path (`daily/2026-11-13.json`), or null when there is none. */
  heroData: (path: string) => Promise<Snapshot | null>;
  /** Unix seconds. */
  now: number;
  /** Games before this (Unix seconds) are from an older patch and are not used. */
  patchStart: number;
  dryRun: boolean;
}

export interface EdgeResult {
  days: EdgeDays;
  added: { day: string; games: number }[];
  skipped: { day: string; why: string }[];
}

const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const startOf = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;

/** The explorer query for a sample of one UTC day's ranked All Pick games over 15 minutes. */
export function edgeDayQuery(day: string): string {
  const from = startOf(day);
  return (
    "select match_id, radiant_win, avg_rank_tier, radiant_team, dire_team from public_matches " +
    `where lobby_type = 7 and game_mode = 22 and duration >= 900 and start_time >= ${from} and start_time < ${from + DAY_S} ` +
    `and match_id % ${EDGE_SAMPLE_EVERY} = 0 limit ${EDGE_ROWS}`
  );
}

/**
 * The days to keep: the last EDGE_DAYS whole UTC days before `now`, and only days whose copy of the
 * day before was built after the patch came out. Oldest first.
 */
export function edgeWindow(now: number, patchStart: number): string[] {
  const today = startOf(dayOf(now));
  const firstFair = startOf(dayOf(patchStart)) + 2 * DAY_S;
  const days: string[] = [];
  for (let t = today - EDGE_DAYS * DAY_S; t < today; t += DAY_S) if (t >= firstFair) days.push(dayOf(t));
  return days;
}

interface PublicGame {
  radiantWin: boolean;
  rankTier: number | null;
  radiant: number[];
  dire: number[];
}

const isTeam = (x: unknown): x is number[] => Array.isArray(x) && x.length === 5 && x.every((h) => Number.isSafeInteger(h) && h > 0);

/** The explorer's rows as games; rows with a missing or odd field are left out. */
export function toPublicGames(rows: unknown): PublicGame[] {
  if (!Array.isArray(rows)) throw new Error("Explorer answer has no rows");
  const out: PublicGame[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const { radiant_win: win, avg_rank_tier: rank, radiant_team: radiant, dire_team: dire } = row ?? {};
    if (typeof win !== "boolean" || !isTeam(radiant) || !isTeam(dire)) continue;
    out.push({ radiantWin: win, rankTier: typeof rank === "number" ? rank : null, radiant, dire });
  }
  return out;
}

/** Radiant's draft edge and result for each game whose heroes are all in the hero data. */
export function scoreGames(snapshot: Snapshot, games: PublicGame[]): [number, 0 | 1][] {
  const engine = new Engine(snapshot);
  return games
    .filter((g) => [...g.radiant, ...g.dire].every((h) => snapshot.heroes[h]))
    .map((g) => [Math.round(draftEdge(engine, g.radiant, g.dire, bracketOf(g.rankTier)) * 10) / 10, g.radiantWin ? 1 : 0]);
}

/**
 * Adds the missing days of the window to the store and drops days that left it. A day with no copy
 * of the day before, or whose query fails, is skipped and tried again on the next run.
 */
export async function addEdgeDays(deps: EdgeDeps): Promise<EdgeResult> {
  const window = edgeWindow(deps.now, deps.patchStart);
  const saved = await deps.store.load();
  const days: EdgeDays = {};
  for (const day of window) if (saved[day]) days[day] = saved[day];
  const added: EdgeResult["added"] = [];
  const skipped: EdgeResult["skipped"] = [];
  for (const day of window) {
    if (days[day]) continue;
    const copy = await deps.heroData(`daily/${dayOf(startOf(day) - DAY_S)}.json`);
    if (!copy) {
      skipped.push({ day, why: "no hero data copy of the day before" });
      continue;
    }
    let games: PublicGame[] | null = null;
    let why = "";
    // The explorer answers 400 when a query on a day it has not read lately runs too long; the
    // second try usually finds it warm.
    for (let attempt = 0; attempt < QUERY_ATTEMPTS && !games; attempt++) {
      try {
        const answer = await deps.openDota<{ rows?: unknown; err?: unknown }>(`/explorer?sql=${encodeURIComponent(edgeDayQuery(day))}`);
        if (answer.err) throw new Error(`Explorer error: ${String(answer.err)}`);
        games = toPublicGames(answer.rows);
      } catch (err) {
        why = err instanceof Error ? err.message : String(err);
      }
    }
    if (!games) {
      skipped.push({ day, why });
      continue;
    }
    if (games.length === 0) {
      skipped.push({ day, why: "no games" });
      continue;
    }
    days[day] = scoreGames(copy, games);
    added.push({ day, games: days[day].length });
  }
  const dropped = Object.keys(saved).some((day) => !days[day]);
  if (!deps.dryRun && (added.length > 0 || dropped)) await deps.store.save(days);
  return { days, added, skipped };
}
