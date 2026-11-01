/**
 * Picks which item timings to trust for one player: their own rank group when it has enough games
 * and items, else every rank, else none (the build then shows its rough "around" minutes). The
 * same slice later gives both the core items and their minutes, so a pos 4 Tiny gets a pos 4
 * build with real minutes (Game Story plan, Item timings).
 */
import { rankGroup, type ItemInfo, type ItemTimingSlice, type Position, type RankBracket, type Snapshot } from "./types";

/** A slice needs this many games (purchases of its most bought item) before its minutes are trusted. */
export const MIN_SLICE_GAMES = 200;
/** ...and this many items that are not parts of another item in it, to fill a core build. */
export const MIN_SLICE_ITEMS = 6;

export interface ChosenSlice {
  /** "rank" when it is the player's own rank group, "all" for every rank. */
  source: "rank" | "all";
  slice: ItemTimingSlice;
}

/** The slice's items without the ones another of its items is built from (Yasha in Manta Style). */
export function finishedItems(slice: ItemTimingSlice, items: Record<string, ItemInfo>): ItemTimingSlice["items"] {
  const parts = new Set(slice.items.flatMap(([id]) => items[id]?.components ?? []));
  return slice.items.filter(([id]) => !parts.has(id));
}

function isUsable(slice: ItemTimingSlice | undefined, items: Record<string, ItemInfo>): slice is ItemTimingSlice {
  return !!slice && slice.games >= MIN_SLICE_GAMES && finishedItems(slice, items).length >= MIN_SLICE_ITEMS;
}

/**
 * The item timings for `heroId` at `position`: the player's rank group first, then every rank.
 * Null when neither has enough data, when there is no timing data, or the hero is off its main positions.
 */
export function chooseTimingSlice(
  data: Snapshot,
  heroId: number,
  position: Position,
  rankBracket?: RankBracket,
): ChosenSlice | null {
  const slices = data.itemTimings?.[heroId]?.[position];
  const items = data.items;
  if (!slices || !items) return null;
  if (rankBracket !== undefined) {
    const own = slices[`${rankGroup(rankBracket)}`];
    if (isUsable(own, items)) return { source: "rank", slice: own };
  }
  const all = slices.all;
  return isUsable(all, items) ? { source: "all", slice: all } : null;
}
