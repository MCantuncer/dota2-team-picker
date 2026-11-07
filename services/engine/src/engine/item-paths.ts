/**
 * What high-rank winners bought when the key item was late (Two-Path Item Journey, plan
 * /mnt/project-files/game-story/two-path-plan.md). Descriptive only: no odds, no "this wins more".
 *
 * The games are a hero and position's STRATZ guide matches this patch (all wins). For each candidate key
 * item K with a late minute L, the games still running at L split into on time (K before L) and late (no K
 * by L). The late group's path is the most common next big item at each step; no single game has to match it.
 * The main path on the card stays today's build list, so it agrees with the Story.
 */
import { isUpgradedBoots, KEY_ITEM_MIN_COST } from "./item-build";
import { bigItems, type IsBig } from "./item-odds";
import { finishedItems } from "./item-timing-slice";
import type { ItemInfo, ItemTimingSlice } from "./types";

/** One guide game's purchases: [item id, seconds], and its length in seconds. */
export interface PathGame {
  duration: number;
  items: [number, number][];
}

/** One step of the late path: the item, its minute, and how many late games bought it next. */
export type PathStep = [itemId: number, minute: number, games: number];

export interface KeyPaths {
  /** The minute after which the key item counts as late. */
  late: number;
  /** Games still running at `late`, and how many of them had the key item by then. */
  running: number;
  onTime: number;
  /** The late group's path, when the group has MIN_GROUP games and a first step passes. */
  path?: {
    games: number;
    steps: PathStep[];
    /** Late games that bought the key item after `late`. */
    keyLater: number;
  };
}

/** The late group needs this many games for a path. */
export const MIN_GROUP = 12;
/** A step needs this share of the late group buying it next. */
export const STEP_SHARE = 0.4;
/** A key item needs this share of the running games buying it at some point. */
export const KEY_SHARE = 0.3;
export const MAX_STEPS = 6;
/** Blink plus this many costly items, the ones game-plan.ts keyItem picks from. */
const COSTLY_KEYS = 2;

function median(xs: number[]): number {
  const s = [...xs].sort((x, y) => x - y);
  const mid = s.length >> 1;
  // s is never empty here (a step has at least one game).
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Candidate key items with their late minute: Blink when the slice has it, plus the first COSTLY_KEYS big
 * items by minute that cost at least KEY_ITEM_MIN_COST and aren't upgraded boots.
 */
export function candidateKeys(
  slice: ItemTimingSlice,
  items: Record<string, ItemInfo>,
  isBig: IsBig,
): { id: number; late: number }[] {
  const byMinute = [...finishedItems(slice, items)].sort((a, b) => a[1] - b[1]);
  const blink = byMinute.filter(([id]) => items[String(id)]?.key === "blink");
  const costly = byMinute
    .filter(([id]) => {
      const item = items[String(id)];
      return isBig(id) && item?.key !== "blink" && (item?.cost ?? 0) >= KEY_ITEM_MIN_COST && !isUpgradedBoots(item);
    })
    .slice(0, COSTLY_KEYS);
  return [...blink, ...costly].map(([id, , late]) => ({ id, late: Math.round(late) }));
}

/** The most common next big item at each step of `games`, following each game's own order. */
export function latePath(games: PathGame[], isBig: IsBig): PathStep[] {
  const lists = games.map((g) => bigItems(g, isBig));
  const cursor = lists.map(() => 0);
  const steps: PathStep[] = [];
  let floor = 0;
  while (steps.length < MAX_STEPS) {
    const used = new Set(steps.map(([id]) => id));
    const next = lists.map((list, g) => list.slice(cursor[g]).find(([id]) => !used.has(id)));
    const counts = new Map<number, number[]>();
    next.forEach((n) => {
      if (n) counts.set(n[0], [...(counts.get(n[0]) ?? []), n[1]]);
    });
    // Most games first, then the earlier median minute, then the lower id, so the same games give the same path.
    const best = [...counts].sort((x, y) => y[1].length - x[1].length || median(x[1]) - median(y[1]) || x[0] - y[0])[0];
    if (!best || best[1].length < STEP_SHARE * games.length) break;
    const [id, times] = best;
    // Each step's median comes from different games, so a later step could come out earlier; it is held at the last.
    const minute = Math.max(Math.round(median(times) / 60), floor);
    floor = minute;
    steps.push([id, minute, times.length]);
    lists.forEach((list, g) => {
      if (next[g]?.[0] === id) cursor[g] = list.findIndex(([x]) => x === id) + 1;
    });
  }
  return steps;
}

/** The paths for one key item, or undefined when too few games buy it. */
export function keyPaths(games: PathGame[], key: number, late: number, isBig: IsBig): KeyPaths | undefined {
  const running = games.filter((g) => g.duration > late * 60);
  const buysKey = (g: PathGame) => g.items.some(([id]) => id === key);
  if (running.length === 0 || running.filter(buysKey).length < KEY_SHARE * running.length) return undefined;
  const onTime = running.filter((g) => g.items.some(([id, t]) => id === key && t < late * 60));
  const lateGames = running.filter((g) => !onTime.includes(g));
  const out: KeyPaths = { late, running: running.length, onTime: onTime.length };
  if (lateGames.length < MIN_GROUP) return out;
  const steps = latePath(lateGames, isBig);
  if (steps.length === 0) return out;
  return { ...out, path: { games: lateGames.length, steps, keyLater: lateGames.filter(buysKey).length } };
}

/** Every candidate key's paths for one hero and position; `{}` when none passes, so the slice isn't fetched again. */
export function itemPaths(
  games: PathGame[],
  slice: ItemTimingSlice | undefined,
  items: Record<string, ItemInfo>,
  isBig: IsBig,
): Record<string, KeyPaths> {
  if (!slice) return {};
  return Object.fromEntries(
    candidateKeys(slice, items, isBig).flatMap(({ id, late }) => {
      const paths = keyPaths(games, id, late, isBig);
      return paths ? [[String(id), paths]] : [];
    }),
  );
}
