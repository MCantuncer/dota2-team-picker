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
 * Each game with the copy to score it with: the newest one built before the game started.
 * `builtAt` is each copy's build time in Unix seconds, in any order. Games older than every copy
 * are left out. Returns one group per copy that scores at least one game, oldest copy first.
 */
export function groupByCopy<T>(games: EvalMatch[], copies: { copy: T; builtAt: number }[]): { copy: T; games: EvalMatch[] }[] {
  const sorted = [...copies].sort((a, b) => a.builtAt - b.builtAt);
  const groups = sorted.map((c) => ({ copy: c.copy, games: [] as EvalMatch[] }));
  for (const game of games) {
    let at = -1;
    for (let i = 0; i < sorted.length && sorted[i]!.builtAt < game.startTime; i++) at = i;
    if (at >= 0) groups[at]!.games.push(game);
  }
  return groups.filter((g) => g.games.length > 0);
}
