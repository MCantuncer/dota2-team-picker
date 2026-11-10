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
 * ...or at least this many, when no slice is full. STRATZ keeps few items for some heroes and positions
 * (carry Vengeful Spirit: 12,486 games, five finished items; support Abaddon: three), and real items with
 * real minutes beat OpenDota's rough list, which mixes every position: it lost carry Venge's Aghanim's
 * Scepter and gave support Abaddon Radiance and Bloodthorn. The build then has fewer core items, all of
 * them this position's own; an empty slot says less than an item the position does not buy.
 */
export const THIN_SLICE_MIN_ITEMS = 1;

export interface ChosenSlice {
  /** "rank" when it is the player's own rank group, "all" for every rank. */
  source: "rank" | "all";
  slice: ItemTimingSlice;
}

/**
 * A part bought this many minutes or more before the item built from it is played with on its own, so it
 * stays an item of the build. Slark buys Diffusal Blade at 14 and Disperser at 38: hiding the part dropped
 * his most bought item, and Disperser was too late to make the build. In the live slices (2026-11-11) real
 * steps come sooner: Yasha 4 minutes before Manta Style, Maelstrom 6 before Mjollnir, Dragon Lance 7 before
 * Hurricane Pike (medians); held parts come far earlier: Diffusal Blade 20, Blink Dagger 14 before Swift Blink.
 */
export const PART_HELD_MINUTES = 8;

/**
 * The slice's items without the ones another of its items is built from soon after (Yasha in Manta Style),
 * all the way down: Dagon is part of Dagon 3 through Dagon 2 even when the slice has no Dagon 2. A part
 * bought PART_HELD_MINUTES or more before the item built from it stays.
 */
export function finishedItems(slice: ItemTimingSlice, items: Record<string, ItemInfo>): ItemTimingSlice["items"] {
  const minute = new Map(slice.items.map(([id, m]) => [id, m]));
  const steps = new Set<number>();
  for (const [id, built] of slice.items) {
    const seen = new Set<number>();
    const addParts = (of: number) => {
      for (const part of items[of]?.components ?? []) {
        if (seen.has(part)) continue;
        seen.add(part);
        const at = minute.get(part);
        if (at !== undefined && built - at < PART_HELD_MINUTES) steps.add(part);
        addParts(part);
      }
    };
    addParts(id);
  }
  return slice.items.filter(([id]) => !steps.has(id));
}

/** Finished items in the slice, or 0 when it has too few games to trust. */
function usableItems(slice: ItemTimingSlice | undefined, items: Record<string, ItemInfo>): number {
  return slice && slice.games >= MIN_SLICE_GAMES ? finishedItems(slice, items).length : 0;
}

/**
 * The item timings for `heroId` at `position`: the player's rank group first, then every rank.
 * A slice with FULL_SLICE_ITEMS wins over a thinner one; else the fuller one with THIN_SLICE_MIN_ITEMS.
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
