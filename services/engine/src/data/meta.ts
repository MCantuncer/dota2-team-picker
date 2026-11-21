/**
 * The Meta page's numbers (meta.json in the hero-data bucket): each hero's games and wins per day of the
 * current patch, per rank group, from the OpenDota explorer's ranked games, plus the same for the last
 * BASE_DAYS days of the patch before, so the page can show who rose and fell with the patch.
 *
 * STRATZ's hero counts are rolling windows that do not start again at a patch (see patch-matchups.ts), so
 * the explorer is the one source that holds only this patch's games.
 *
 * A day is 24 hours from the patch's start, not a calendar day. Days that had ended a while before the last
 * meta.json was built are kept from it, so a run only asks for the newest days.
 */
import { GROUP_SQL } from "./patch-matchups";

/** Days of the patch before that the page compares against. */
export const BASE_DAYS = 7;
/** Days of this patch kept: the newest ones once the patch is older. */
export const WINDOW_DAYS = 14;
/** A day counts as complete once this long has passed after its end: its last games have finished by then. */
export const SETTLE_S = 3 * 60 * 60;
/**
 * Days are read together, in slices by match id, so each query aggregates about GAMES_PER_QUERY games and stays
 * under the explorer's 15 s: 8 slices of 7 days (about 3.2 million games) took 2 to 4 s each (Nov 2026). Many
 * small queries did worse: one day in 2 slices timed out three times in a row on days not read lately.
 */
export const GAMES_PER_DAY = 500_000;
export const GAMES_PER_QUERY = 400_000;
/** Rank slices: 0 every rank (unknown ranks too), then the four rank groups. */
export const RANK_SLICES = 5;
const DAY_S = 24 * 60 * 60;

/** One hero's numbers in a day: [games, wins] for every rank, then each rank group 1 to 4, flattened. */
export type HeroDay = number[];

export interface MetaDay {
  /** Days since the patch's start: 0 is its first day, -1 the last day of the patch before. */
  index: number;
  /** When the day starts and ends (ISO). The newest day may still be under way. */
  from: string;
  to: string;
  /** Whether the day had ended SETTLE_S before the numbers were read; only those are kept for the next run. */
  complete: boolean;
  /** Games per rank slice (index 0 every rank, 1 to 4 the rank groups). */
  games: number[];
  /** Per hero id. */
  heroes: Record<string, HeroDay>;
}

export interface MetaFile {
  computedAt: string;
  patch: { name: string; startedAt: string };
  /** This patch's days in the window, oldest first. */
  days: MetaDay[];
  /** The patch before's last BASE_DAYS days, oldest first. */
  base: MetaDay[];
  /** Each hero's share of its games per position 1 to 5, in whole percent, from the snapshot's STRATZ positions. */
  roles: Record<string, number[]>;
}

/** Position counts as whole percent shares; heroes with no games are left out. */
export function roleShares(positions: Record<string, number[]> | undefined): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [hero, games] of Object.entries(positions ?? {})) {
    const total = games.reduce((a, b) => a + b, 0);
    if (total > 0 && games.length === 5) out[hero] = games.map((g) => Math.round((g / total) * 100));
  }
  return out;
}

/** Heroes on one side per day (from `from`) and rank group: games and that side's wins. */
export function daysQuery(from: number, to: number, side: "radiant" | "dire", slices: number, slice: number): string {
  const won = side === "radiant" ? "m.radiant_win" : "not m.radiant_win";
  return (
    `select floor((m.start_time - ${Math.floor(from)}) / ${DAY_S})::int as d, ${GROUP_SQL} as g, h, count(*) as games, ` +
    `sum(case when ${won} then 1 else 0 end) as wins from public_matches m, unnest(m.${side}_team) h ` +
    `where m.start_time >= ${Math.floor(from)} and m.start_time < ${Math.floor(to)} and m.lobby_type = 7 and m.game_mode = 22 ` +
    `and m.duration > 900 and m.match_id % ${slices} = ${slice} group by 1, 2, 3`
  );
}

export interface HeroRow {
  /** Days after the first day read. */
  d: number;
  g: number;
  h: number;
  games: number;
  wins: number;
}

/** The explorer writes big counts as text; both forms are read. */
const whole = (x: unknown) => {
  const n = typeof x === "string" && x.trim() !== "" ? Number(x) : x;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};

/** The explorer's rows; rows with a missing or odd field are left out. */
export function toHeroRows(rows: unknown): HeroRow[] {
  if (!Array.isArray(rows)) throw new Error("Explorer answer has no rows");
  const out: HeroRow[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const [d, g, h, games, wins] = [row?.d, row?.g, row?.h, row?.games, row?.wins].map(whole);
    if (d === undefined || g === undefined || g >= RANK_SLICES || !h || !games || wins === undefined || wins > games) continue;
    out.push({ d, g, h, games, wins });
  }
  return out;
}

/** Adds rows to a day: every row to every rank, and to its rank group when the game's rank is known. */
export function addRows(day: Pick<MetaDay, "heroes">, rows: Omit<HeroRow, "d">[]) {
  for (const { g, h, games, wins } of rows) {
    const hero = (day.heroes[h] ??= new Array<number>(RANK_SLICES * 2).fill(0));
    for (const slice of g ? [0, g] : [0]) {
      hero[slice * 2] = (hero[slice * 2] ?? 0) + games;
      hero[slice * 2 + 1] = (hero[slice * 2 + 1] ?? 0) + wins;
    }
  }
}

/** Games per rank slice: every game has ten heroes. */
export function gamesOf(heroes: Record<string, HeroDay>): number[] {
  const games = new Array<number>(RANK_SLICES).fill(0);
  for (const hero of Object.values(heroes)) for (let s = 0; s < RANK_SLICES; s++) games[s]! += hero[s * 2] ?? 0;
  return games.map((g) => Math.round(g / 10));
}

/** The day indexes to show at `now`: the newest WINDOW_DAYS of the patch, and the BASE_DAYS before it. */
export function dayIndexes(patchStart: number, now: number): { days: number[]; base: number[] } {
  const today = Math.floor((now - patchStart) / DAY_S);
  const first = Math.max(0, today - WINDOW_DAYS + 1);
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  return { days: today < 0 ? [] : range(first, today), base: range(-BASE_DAYS, -1) };
}

export type Ask = (sql: string) => Promise<unknown>;

/** The days from index `first` to `last`, read together in slices of about GAMES_PER_QUERY games per side. */
export async function readDays(ask: Ask, patchStart: number, first: number, last: number, now: number): Promise<MetaDay[]> {
  const from = patchStart + first * DAY_S;
  const to = Math.min(patchStart + (last + 1) * DAY_S, now);
  const days: MetaDay[] = [];
  for (let index = first; index <= last; index++) {
    const start = patchStart + index * DAY_S;
    days.push({
      index,
      from: new Date(start * 1000).toISOString(),
      to: new Date((start + DAY_S) * 1000).toISOString(),
      complete: now >= start + DAY_S + SETTLE_S,
      games: [],
      heroes: {},
    });
  }
  const slices = Math.max(1, Math.ceil((((to - from) / DAY_S) * GAMES_PER_DAY) / GAMES_PER_QUERY));
  for (const side of ["radiant", "dire"] as const) {
    for (let slice = 0; slice < slices; slice++) {
      const rows = toHeroRows(await ask(daysQuery(from, to, side, slices, slice)));
      for (const day of days) addRows(day, rows.filter((r) => r.d === day.index - first));
    }
  }
  for (const day of days) day.games = gamesOf(day.heroes);
  return days;
}

/**
 * Days `first` to `last`, read together; when that fails, each half on its own, down to single days. A long run
 * of days the explorer has not read lately can stay over its 15 s on every try (7 days of the patch before,
 * Nov 2026), while each try leaves part of them read, so the halves get through.
 */
export async function readRun(ask: Ask, patchStart: number, first: number, last: number, now: number): Promise<MetaDay[]> {
  try {
    return await readDays(ask, patchStart, first, last, now);
  } catch (err) {
    if (first === last) throw err;
    const middle = Math.floor((first + last) / 2);
    console.warn(`Reading days ${first} to ${last} failed, reading ${first} to ${middle} and ${middle + 1} to ${last} apart`);
    return [...(await readRun(ask, patchStart, first, middle, now)), ...(await readRun(ask, patchStart, middle + 1, last, now))];
  }
}

/**
 * The Meta numbers at `now` (Unix seconds). Complete days of `last` (the published file) for the same patch
 * are kept; every other day is read. Throws when a query fails, so a run never publishes a partial day.
 */
export async function buildMeta(
  ask: Ask,
  patch: { name: string; startedAt: string },
  now: number,
  last: MetaFile | null,
  positions?: Record<string, number[]>,
): Promise<MetaFile> {
  const patchStart = Date.parse(patch.startedAt) / 1000;
  if (!Number.isFinite(patchStart)) throw new Error(`Patch ${patch.name} has no start time`);
  const kept = new Map<number, MetaDay>();
  if (last?.patch.name === patch.name && last.patch.startedAt === patch.startedAt) {
    for (const day of [...last.base, ...last.days]) if (day.complete) kept.set(day.index, day);
  }
  const { days, base } = dayIndexes(patchStart, now);
  const byIndex = new Map<number, MetaDay>();
  // Each unbroken run of days not kept is read together: the patch before's days and this patch's apart.
  for (const indexes of [base, days]) {
    const missing = indexes.filter((i) => !kept.has(i));
    for (const [first, last] of runs(missing)) for (const day of await readRun(ask, patchStart, first, last, now)) byIndex.set(day.index, day);
  }
  const pick = (i: number) => kept.get(i) ?? byIndex.get(i)!; // every index is kept or was just read
  return { computedAt: new Date(now * 1000).toISOString(), patch, days: days.map(pick), base: base.map(pick), roles: roleShares(positions) };
}

/** Sorted indexes as [first, last] runs of consecutive numbers. */
export function runs(indexes: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const i of indexes) {
    const lastRun = out[out.length - 1];
    if (lastRun && lastRun[1] === i - 1) lastRun[1] = i;
    else out.push([i, i]);
  }
  return out;
}
