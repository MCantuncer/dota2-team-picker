/**
 * Picks which item timings to trust for one player: their own rank group when it has enough games
 * and items, else every rank. When neither is full, the one with more finished items, as long as it
 * has THIN_SLICE_MIN_ITEMS; else none (the build then shows its rough "around" minutes). The same
 * slice later gives both the core items and their minutes, so a pos 4 Tiny gets a pos 4 build with
 * real minutes (Game Story plan, Item timings).
 */
import { rankGroup, type ItemInfo, type ItemTimingSlice, type Position, type RankBracket, type Snapshot } from "./types";

/** A slice needs this many games (purchases of its most bought item) before its minutes are trusted. */
export const MIN_SLICE_GAMES = 200;
/** ...and this many items that are not parts of another item in it, to fill a core build... */
export const FULL_SLICE_ITEMS = 6;
/**
 * ...or at least this many, when no slice is full. STRATZ keeps few items for some heroes (carry
 * Vengeful Spirit: 12,486 games, five finished items), and real items with real minutes beat
 * OpenDota's rough list, which mixes every position (it lost carry Venge's Aghanim's Scepter).
 * The build then has fewer core items, all of them this position's own.
 */
export const THIN_SLICE_MIN_ITEMS = 4;

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

/** Finished items in the slice, or 0 when it has too few games to trust. */
function usableItems(slice: ItemTimingSlice | undefined, items: Record<string, ItemInfo>): number {
  return slice && slice.games >= MIN_SLICE_GAMES ? finishedItems(slice, items).length : 0;
}

/**
 * The item timings for `heroId` at `position`: the player's rank group first, then every rank.
 * A slice with FULL_SLICE_ITEMS wins over a thinner one; else the fuller one with THIN_SLICE_MIN_ITEMS. Null when neither has enough data, when
 * there is no timing data, or the hero is off its main positions.
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
  const own = rankBracket === undefined ? undefined : slices[`${rankGroup(rankBracket)}`];
  const all = slices.all;
  const ownItems = usableItems(own, items);
  const allItems = usableItems(all, items);
  if (own && ownItems >= FULL_SLICE_ITEMS) return { source: "rank", slice: own };
  if (all && allItems >= FULL_SLICE_ITEMS) return { source: "all", slice: all };
  // Neither is full: a rank group is thin because it has fewer games, not because players buy less,
  // so it only wins with at least as many items as every rank (ties go to the rank group).
  if (own && ownItems >= THIN_SLICE_MIN_ITEMS && ownItems >= allItems) return { source: "rank", slice: own };
  if (all && allItems >= THIN_SLICE_MIN_ITEMS) return { source: "all", slice: all };
  return null;
}
