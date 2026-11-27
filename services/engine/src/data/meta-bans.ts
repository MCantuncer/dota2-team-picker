/**
 * Ban counts for the Meta page (meta.json `bans`), from the saved ranked games (see eval-matches.ts). The OpenDota
 * explorer's public games hold no bans, and STRATZ stopped counting ranked bans (about 4,500 a day in Nov 2026,
 * against some 400,000 ranked games a day), so the saved games, about 420 a day with every ban, are the one sample.
 *
 * Days are the Meta page's days (see meta.ts): 24 hours from the patch's start, this patch's newest WINDOW_DAYS and
 * the BASE_DAYS before it. They are counted again each run from the month files, since games keep being saved for a
 * few hours after they end.
 */
import type { EvalMatch } from "./eval-matches";
import { dayIndexes, RANK_SLICES } from "./meta";

const DAY_S = 24 * 60 * 60;
/** A day's saved games are all in once this long has passed after its end: the collector saves games 2 to 8 hours old, every 4 hours. */
export const SAVE_LAG_S = 12 * 60 * 60;

/** One day's bans: games per rank slice, and per hero id the games it was banned in, per rank slice. */
export interface BanDay {
  /** Days since the patch's start, as in MetaDay. */
  index: number;
  /** Whether every saved game of the day is in. */
  complete: boolean;
  games: number[];
  heroes: Record<string, number[]>;
}

export interface MetaBans {
  /** This patch's days in the window and the patch before's last days, oldest first, as the Meta days. */
  days: BanDay[];
  base: BanDay[];
}

/** The rank group of an average rank tier, as the explorer's GROUP_SQL: 1 Herald and Guardian to 4 Divine and Immortal, 0 unknown. */
export function rankGroup(tier: number | null): number {
  if (tier === null || !Number.isFinite(tier) || tier < 10 || tier >= 90) return 0;
  return Math.floor((Math.floor(tier / 10) + 1) / 2);
}

/** The ban counts of the days `indexes` from the saved `games`, at `now` (Unix seconds). */
export function banDays(games: EvalMatch[], patchStart: number, indexes: number[], now: number): BanDay[] {
  const days = new Map<number, BanDay>(
    indexes.map((index) => [
      index,
      { index, complete: now >= patchStart + (index + 1) * DAY_S + SAVE_LAG_S, games: new Array<number>(RANK_SLICES).fill(0), heroes: {} },
    ]),
  );
  for (const game of games) {
    const day = days.get(Math.floor((game.startTime - patchStart) / DAY_S));
    if (!day) continue;
    const group = rankGroup(game.rankTier);
    const slices = group ? [0, group] : [0];
    for (const s of slices) day.games[s]! += 1;
    for (const hero of new Set(game.bans)) {
      const counts = (day.heroes[hero] ??= new Array<number>(RANK_SLICES).fill(0));
      for (const s of slices) counts[s]! += 1;
    }
  }
  return indexes.map((i) => days.get(i)!);
}

/** The Meta page's ban counts at `now` (Unix seconds) from the saved games of the patch's days and the days before. */
export function buildBans(games: EvalMatch[], patchStartedAt: string, now: number): MetaBans {
  const patchStart = Date.parse(patchStartedAt) / 1000;
  if (!Number.isFinite(patchStart)) throw new Error(`Patch start ${patchStartedAt} can't be read`);
  const { days, base } = dayIndexes(patchStart, now);
  return { days: banDays(games, patchStart, days, now), base: banDays(games, patchStart, base, now) };
}
