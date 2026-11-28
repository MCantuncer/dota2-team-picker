/**
 * Each hero's win rate for the pick scores, weighted to the newest days the way the Meta page weighs them.
 *
 * OpenDota's heroStats (snapshot.bracketStats) count the whole patch so far as one, so a letter patch that nerfs a
 * hero shows up slowly: two days after 7.42a, heroStats still had Phantom Assassin at 53.0% and Riki at 55.9%, while
 * since 7.42a they won 50.3% and 53.5% (the Meta page's days, from the OpenDota explorer). Each refresh now reads the
 * last meta.json and moves every rank group's win rate to the Meta page's weighted rate (dayWeights below: from a fresh
 * letter patch on every day counts fully, before that each day counts half the day after it). Inside a group, the
 * brackets keep heroStats' differences from each other, and the pick counts stay heroStats', so pick rates and the
 * amount of evidence behind each rate don't change.
 *
 * A group with fewer than MIN_GROUP_GAMES weighted games keeps heroStats' rate, and a meta.json of another patch or
 * older than MAX_META_AGE_HOURS is not used at all: the pick scores then run on heroStats as before.
 */
import type { MetaDay, MetaFile } from "./meta";
import type { Snapshot } from "../engine/types";

/** Days a letter patch's games keep counting fully, like the Meta page's LETTER_FRESH_DAYS. */
export const LETTER_FRESH_DAYS = 14;
/** Each day before the anchor day counts this much less per day, like the Meta page's HALF_LIFE_DAYS. */
export const HALF_LIFE_DAYS = 1;
/** Weighted games a hero needs in a rank group for that group's rate to be used (about ±1 point at 95%). */
export const MIN_GROUP_GAMES = 3000;
/** A meta.json older than this (by its computedAt) is not used: its newest days would no longer be the newest. */
export const MAX_META_AGE_HOURS = 36;
const DAY_MS = 86_400_000;

/** The patch day (0 is the patch's first day) a letter patch came out on, while it is younger than LETTER_FRESH_DAYS. */
export function letterDay(patch: MetaFile["patch"], now: Date): number | undefined {
  const release = patch.release;
  if (!release || release.name === patch.name) return undefined;
  const [patchMs, releaseMs] = [Date.parse(patch.startedAt), Date.parse(release.startedAt)];
  if (!Number.isFinite(patchMs) || !Number.isFinite(releaseMs)) return undefined;
  if (releaseMs <= patchMs || now.getTime() - releaseMs >= LETTER_FRESH_DAYS * DAY_MS) return undefined;
  return Math.floor((releaseMs - patchMs) / DAY_MS);
}

/**
 * Each day's weight, the same as the Meta page's dayWeights: 1 for the newest complete day and the day still running,
 * halving every HALF_LIFE_DAYS before it. With a fresh letter patch, every day from the one it came out on counts fully.
 */
export function dayWeights(days: Pick<MetaDay, "index" | "complete">[], letter?: number): number[] {
  let newest = days.length - 1;
  while (newest > 0 && !days[newest]?.complete) newest--;
  const newestIndex = days[newest]?.index ?? 0;
  const anchor = letter === undefined ? newestIndex : Math.min(letter, newestIndex);
  return days.map((d) => 0.5 ** (Math.max(0, anchor - d.index) / HALF_LIFE_DAYS));
}

/** Why meta.json can't be used for this snapshot, or null when it can. */
export function unusable(meta: MetaFile, snapshot: Pick<Snapshot, "patch">, now: Date): string | null {
  const patch = snapshot.patch;
  if (!patch) return "the snapshot has no patch";
  if (meta.patch?.name !== patch.name || meta.patch.startedAt !== patch.startedAt) return `meta.json is for patch ${meta.patch?.name}`;
  const age = (now.getTime() - Date.parse(meta.computedAt)) / 3_600_000;
  if (!Number.isFinite(age) || age > MAX_META_AGE_HOURS) return `meta.json is ${Number.isFinite(age) ? Math.round(age) : "?"} hours old`;
  if (!Array.isArray(meta.days) || !meta.days.length) return "meta.json has no days";
  return null;
}

export interface RecentWinRates {
  /** Hero rank groups whose rate moved. */
  groups: number;
  /** The heroes whose all-ranks rate moved most, with heroStats' rate and the new one, in percent. */
  moved: { id: number; from: number; to: number }[];
}

/** Brackets 1 to 8 (index 0 to 7) by rank group 1 to 4, two medals each like the explorer's rank groups. */
const GROUP_BRACKETS: readonly (readonly number[])[] = [[0, 1], [2, 3], [4, 5], [6, 7]];

/**
 * Moves each hero's win rate per rank group in snapshot.bracketStats to meta.json's weighted rate (see the top of
 * this file). Changes only wins; returns what moved. The caller checks `unusable` first.
 */
export function applyRecentWinRates(snapshot: Snapshot, meta: MetaFile, now: Date): RecentWinRates {
  const weights = dayWeights(meta.days, letterDay(meta.patch, now));
  const rate = (s: { picks: number[]; wins: number[] }) => {
    const picks = s.picks.reduce((a, b) => a + b, 0);
    return picks ? s.wins.reduce((a, b) => a + b, 0) / picks : 0.5;
  };
  let groups = 0;
  const moved: RecentWinRates["moved"] = [];
  for (const [id, stats] of Object.entries(snapshot.bracketStats)) {
    const before = rate(stats);
    GROUP_BRACKETS.forEach((brackets, g) => {
      let games = 0;
      let wins = 0;
      meta.days.forEach((d, i) => {
        const day = d.heroes[id];
        games += (weights[i] ?? 0) * (day?.[(g + 1) * 2] ?? 0);
        wins += (weights[i] ?? 0) * (day?.[(g + 1) * 2 + 1] ?? 0);
      });
      const picks = brackets.reduce((n, b) => n + (stats.picks[b] ?? 0), 0);
      if (games < MIN_GROUP_GAMES || picks === 0) return;
      const shift = wins / games - brackets.reduce((n, b) => n + (stats.wins[b] ?? 0), 0) / picks;
      for (const b of brackets) {
        const p = stats.picks[b] ?? 0;
        if (!p) continue;
        const r = Math.min(1, Math.max(0, (stats.wins[b] ?? 0) / p + shift));
        stats.wins[b] = Math.round(p * r);
      }
      groups++;
    });
    const after = rate(stats);
    if (Math.abs(after - before) >= 0.0005) moved.push({ id: Number(id), from: before * 100, to: after * 100 });
  }
  moved.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  return { groups, moved };
}
