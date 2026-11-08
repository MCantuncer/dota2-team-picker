/**
 * Live backtest: score saved games with the hero data the website really had when they were
 * played. The refresh job keeps a copy of the hero data per day (`daily/<YYYY-MM-DD>.json`, see
 * data/upload.ts); each game is scored with the newest copy built before it started, so the
 * engine never sees the game it is scored on, and a change to the engine is measured on the
 * data it will run on rather than on the older copy in the repo.
 */
import type { EvalMatch } from "../data/eval-matches";

/** The daily copy of the hero data for a UTC date, as the upload saves it. */
export const dailySource = (date: string) => `daily/${date}.json`;

const DAY_S = 24 * 60 * 60;
const utcDate = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/**
 * The days whose copies could score these games: from the day before the first game to the day
 * of the last. A copy is the last refresh of its day, so a game early on day D needs the copy of
 * day D - 1, and one later on day D may use day D's.
 */
export function copyDays(games: EvalMatch[]): string[] {
  if (!games.length) return [];
  const first = Math.min(...games.map((g) => g.startTime)) - DAY_S;
  const last = Math.max(...games.map((g) => g.startTime));
  const days: string[] = [];
  for (let t = first; utcDate(t) <= utcDate(last); t += DAY_S) days.push(utcDate(t));
  return days;
}

/**
 * Scores each game with the newest copy built before it started, loading the copies of `days`
 * (oldest first) one at a time and holding at most two, so a month of 5 MB copies never sits in
 * memory or on disk. `load` returns a copy with its build time in Unix seconds, or null when that
 * day has none. Games older than every copy are left out. A copy built no later than the one
 * before it (a late rebuild of an older day) is skipped, since daily copies are built in order.
 */
export async function scoreByCopy<T>(
  games: EvalMatch[],
  days: string[],
  load: (day: string) => Promise<{ copy: T; builtAt: number } | null>,
  score: (copy: T, games: EvalMatch[]) => void,
): Promise<void> {
  const sorted = [...games].sort((a, b) => a.startTime - b.startTime);
  let current: { copy: T; builtAt: number } | null = null;
  let next = 0;
  // The games up to `until` belong to the current copy: none newer was built before they started.
  const flush = (until: number) => {
    const group: EvalMatch[] = [];
    for (; next < sorted.length && sorted[next]!.startTime <= until; next++) {
      if (current && current.builtAt < sorted[next]!.startTime) group.push(sorted[next]!);
    }
    if (current && group.length) score(current.copy, group);
  };
  for (const day of days) {
    const copy = await load(day);
    if (!copy || (current && copy.builtAt <= current.builtAt)) continue;
    flush(copy.builtAt);
    current = copy;
  }
  flush(Infinity);
}
