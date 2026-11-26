/**
 * Hero vs hero and hero with hero counts from this patch's ranked games only, from the OpenDota explorer.
 *
 * STRATZ counts over a rolling window that does not start again at a new patch: three days after 7.42
 * its counts had grown from 8.4 to 9.8 million games without a reset, so they were still mostly 7.41.
 * For the first PATCH_FRESH_DAYS of a patch the snapshot's counts are this patch's games plus a quarter
 * of STRATZ's (blendCounts), so picks follow the new patch while its sample is still small. After that
 * STRATZ's window holds only the new patch and its counts are used alone again.
 *
 * The explorer stops a query after about 15 seconds, so each query reads one slice of the games
 * (`match_id % slices = slice`) and aggregates it on the server: about 250,000 games and 80,000 rows
 * in under 10 seconds (measured 2026-11-21).
 */
import { type GamesWins, type RankGroup, type Snapshot } from "../engine/types";
import type { StratzCounts } from "./stratz-matchups";

/** Days after a patch comes out that its own games lead the counts. */
export const PATCH_FRESH_DAYS = 14;
/** Share of STRATZ's counts kept next to the patch's games, like the carryover at a new patch. */
export const STRATZ_SHARE = 0.25;
/** Fewer patch games than this (a patch a few hours old) leaves STRATZ's counts alone. */
export const MIN_PATCH_GAMES = 50_000;
/** Games one explorer query aggregates; more time out. */
export const GAMES_PER_SLICE = 250_000;
/** Slices read per run, so a run reads at most about a million games in 13 queries. */
export const MAX_SLICES = 4;
/**
 * Games a day of a patch is taken to have when the explorer can't count them: above the busiest day of 7.42 (556,157 on
 * 2026-11-21), so the slices come out no bigger than they should and the queries don't time out.
 */
export const GAMES_PER_DAY_GUESS = 600_000;
/** Every 5 v 5 game gives this many hero vs hero rows, Radiant hero against Dire hero. */
const VS_ROWS_PER_GAME = 25;
const DAY_S = 24 * 60 * 60;

/** Ranked All Pick games over 15 minutes since `from`, in one slice of `slices` by match id. */
function where(from: number, slices: number, slice: number): string {
  const sample = slices > 1 ? ` and m.match_id % ${slices} = ${slice}` : "";
  return `m.start_time >= ${Math.floor(from)} and m.lobby_type = 7 and m.game_mode = 22 and m.duration > 900${sample}`;
}

/** Our rank group (1 to 4, two medals each) from the game's average rank tier; 0 when unknown. */
export const GROUP_SQL = "case when m.avg_rank_tier >= 10 and m.avg_rank_tier < 90 then (floor(m.avg_rank_tier / 10)::int + 1) / 2 else 0 end";

export function countQuery(from: number): string {
  return `select count(*) as games from public_matches m where ${where(from, 1, 0)}`;
}

/** Radiant hero a against Dire hero b, per rank group: games and Radiant wins. */
export function vsQuery(from: number, slices: number, slice: number): string {
  return (
    `select ${GROUP_SQL} as g, a, b, count(*) as games, sum(case when m.radiant_win then 1 else 0 end) as wins ` +
    `from public_matches m, unnest(m.radiant_team) a, unnest(m.dire_team) b where ${where(from, slices, slice)} group by 1, 2, 3`
  );
}

/** Heroes a < b on the same side, per rank group: games and that side's wins. */
export function withQuery(from: number, slices: number, slice: number, side: "radiant" | "dire"): string {
  const won = side === "radiant" ? "m.radiant_win" : "not m.radiant_win";
  return (
    `select ${GROUP_SQL} as g, a, b, count(*) as games, sum(case when ${won} then 1 else 0 end) as wins ` +
    `from public_matches m, unnest(m.${side}_team) a, unnest(m.${side}_team) b where ${where(from, slices, slice)} and a < b group by 1, 2, 3`
  );
}

export interface PairRow {
  g: 0 | RankGroup;
  a: number;
  b: number;
  games: number;
  wins: number;
}

/** The explorer writes big counts as text; both forms are read. */
const whole = (x: unknown) => {
  const n = typeof x === "string" && x.trim() !== "" ? Number(x) : x;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};

/** The explorer's rows as pairs; rows with a missing or odd field are left out. */
export function toPairRows(rows: unknown): PairRow[] {
  if (!Array.isArray(rows)) throw new Error("Explorer answer has no rows");
  const out: PairRow[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const [g, a, b, games, wins] = [row?.g, row?.a, row?.b, row?.games, row?.wins].map(whole);
    if (g === undefined || g > 4 || !a || !b || a === b || !games || wins === undefined || wins > games) continue;
    out.push({ g: g as PairRow["g"], a, b, games, wins });
  }
  return out;
}

const empty = (): StratzCounts => ({ matchups: {}, synergy: {}, rankMatchups: {}, rankSynergy: {} });

function add(map: Record<string, GamesWins>, key: string, games: number, wins: number) {
  const gw = (map[key] ??= { games: 0, wins: 0 });
  gw.games += games;
  gw.wins += wins;
}

/** Adds rows of vsQuery to the counts: both heroes' side of each pair, every rank and its rank group. */
export function addVs(counts: StratzCounts, rows: PairRow[]) {
  for (const { g, a, b, games, wins } of rows) {
    for (const matchups of g ? [counts.matchups, (counts.rankMatchups[g] ??= {})] : [counts.matchups]) {
      add((matchups[a] ??= {}), String(b), games, wins);
      add((matchups[b] ??= {}), String(a), games, games - wins);
    }
  }
}

/** Adds rows of withQuery to the counts, keyed "a-b" with a < b as the snapshot keeps them. */
export function addWith(counts: StratzCounts, rows: PairRow[]) {
  for (const { g, a, b, games, wins } of rows) {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    for (const synergy of g ? [counts.synergy, (counts.rankSynergy[g] ??= {})] : [counts.synergy]) add(synergy, key, games, wins);
  }
}

/** Games in the counts: each game gives VS_ROWS_PER_GAME pairs, counted from both heroes' rows. */
export function gamesIn(counts: StratzCounts): number {
  let pairs = 0;
  for (const row of Object.values(counts.matchups)) for (const gw of Object.values(row)) pairs += gw.games;
  return Math.round(pairs / 2 / VS_ROWS_PER_GAME);
}

/** Whether the patch that started at `patchStart` (Unix seconds) is still young enough for its own counts. */
export function patchIsFresh(patchStart: number, now: Date): boolean {
  return now.getTime() / 1000 - patchStart < PATCH_FRESH_DAYS * DAY_S;
}

type Get = <T>(path: string) => Promise<T>;

/**
 * One explorer query's rows, tried twice: the explorer answers HTTP 400 when it times out on a cold cache. Throws
 * when it fails both times.
 */
async function explorerRows(get: Get, sql: string): Promise<unknown> {
  const path = `/explorer?sql=${encodeURIComponent(sql)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const answer = await get<{ rows?: unknown; err?: unknown }>(path);
      if (answer.err) throw new Error(`Explorer query failed: ${String(answer.err)}`);
      return answer.rows;
    } catch (err) {
      if (attempt >= 2) throw err;
      console.warn(`${(err as Error).message}, trying once more`);
    }
  }
}

/**
 * Games since `from` (Unix seconds), for the number of slices. When the count fails (it reads every game of the patch
 * and timed out on 2026-11-25), GAMES_PER_DAY_GUESS a day instead: more slices than needed only means each read slice
 * is a smaller share of the games, never a query that times out.
 */
export async function patchGames(get: Get, from: number, now: Date): Promise<number> {
  try {
    const rows = await explorerRows(get, countQuery(from));
    const games = Array.isArray(rows) ? whole((rows[0] as { games?: unknown } | undefined)?.games) : undefined;
    if (games === undefined) throw new Error("Explorer count has no games");
    return games;
  } catch (err) {
    const days = Math.max(1, Math.ceil((now.getTime() / 1000 - from) / DAY_S));
    console.warn(`::warning::Counting the patch's games failed (${(err as Error).message}), taking ${GAMES_PER_DAY_GUESS} a day for ${days} days`);
    return days * GAMES_PER_DAY_GUESS;
  }
}

/**
 * This patch's counts, read in up to MAX_SLICES slices of about GAMES_PER_SLICE games. Throws when a slice's query
 * fails both times, so a run never mixes a partial read in.
 */
export async function fetchPatchCounts(get: Get, patchStart: number, now: Date): Promise<{ counts: StratzCounts; games: number }> {
  const ask = (sql: string) => explorerRows(get, sql);
  const all = await patchGames(get, patchStart, now);
  const slices = Math.max(1, Math.ceil(all / GAMES_PER_SLICE));
  const counts = empty();
  for (let slice = 0; slice < Math.min(slices, MAX_SLICES); slice++) {
    addVs(counts, toPairRows(await ask(vsQuery(patchStart, slices, slice))));
    for (const side of ["radiant", "dire"] as const) addWith(counts, toPairRows(await ask(withQuery(patchStart, slices, slice, side))));
  }
  return { counts, games: gamesIn(counts) };
}

/** a + share x b for every pair of either, rounded to a tenth of a game. */
function blendMap(a: Record<string, GamesWins>, b: Record<string, GamesWins>, share: number): Record<string, GamesWins> {
  const out: Record<string, GamesWins> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const [x, y] = [a[key], b[key]];
    const round = (n: number) => Math.round(n * 10) / 10;
    out[key] = { games: round((x?.games ?? 0) + share * (y?.games ?? 0)), wins: round((x?.wins ?? 0) + share * (y?.wins ?? 0)) };
  }
  return out;
}

function blendMatchups(a: Snapshot["matchups"], b: Snapshot["matchups"], share: number): Snapshot["matchups"] {
  const out: Snapshot["matchups"] = {};
  for (const hero of new Set([...Object.keys(a), ...Object.keys(b)])) out[hero] = blendMap(a[hero] ?? {}, b[hero] ?? {}, share);
  return out;
}

/**
 * The patch's counts plus `share` of STRATZ's, for every slice. Every pair of a slice is blended the same
 * way, so each hero's expected win rate still comes from the same rows as its pairs (see Engine.edge).
 */
export function blendCounts(patch: StratzCounts, stratz: StratzCounts, share = STRATZ_SHARE): StratzCounts {
  const groups = [...new Set([patch, stratz].flatMap((c) => [...Object.keys(c.rankMatchups), ...Object.keys(c.rankSynergy)]))];
  return {
    matchups: blendMatchups(patch.matchups, stratz.matchups, share),
    synergy: blendMap(patch.synergy, stratz.synergy, share),
    rankMatchups: Object.fromEntries(groups.map((g) => [g, blendMatchups(patch.rankMatchups[g] ?? {}, stratz.rankMatchups[g] ?? {}, share)])),
    rankSynergy: Object.fromEntries(groups.map((g) => [g, blendMap(patch.rankSynergy[g] ?? {}, stratz.rankSynergy[g] ?? {}, share)])),
  };
}

/** STRATZ's counts and when they were downloaded. */
export interface DatedCounts {
  counts: StratzCounts;
  at: Date;
}

/** The hero data's counts when they are STRATZ's alone, with no patch games added; else null. */
function stratzOnly(data: Snapshot): DatedCounts | null {
  const from = data.matchupsFrom;
  if (from?.source !== "stratz" || from.patchGames !== undefined) return null;
  const counts = { matchups: data.matchups, synergy: data.synergy, rankMatchups: data.rankMatchups ?? {}, rankSynergy: data.rankSynergy ?? {} };
  return { counts, at: new Date(from.at) };
}

/**
 * STRATZ's last counts, for the blend when this run's STRATZ download fails (it failed on both runs of
 * 2026-11-21, so the patch's games never went in): the snapshot's own counts when they are STRATZ's alone,
 * else the newest daily copy whose are, going back PATCH_FRESH_DAYS + 1 days. Null when there is none.
 */
export async function lastStratzCounts(
  snapshot: Snapshot,
  now: Date,
  load: (path: string) => Promise<Snapshot | null>,
): Promise<DatedCounts | null> {
  const own = stratzOnly(snapshot);
  if (own) return own;
  for (let day = 0; day <= PATCH_FRESH_DAYS + 1; day++) {
    const date = new Date(now.getTime() - day * DAY_S * 1000).toISOString().slice(0, 10);
    const copy = await load(`daily/${date}.json`);
    const found = copy && stratzOnly(copy);
    if (found) return found;
  }
  return null;
}
