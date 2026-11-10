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
 * A part bought this many minutes or more before the item built from it is played with on its own. Slark
 * buys Diffusal Blade at 14 and Disperser at 38: hiding the part dropped his most bought item, and Disperser
 * was too late to make the build. In the live slices (2026-11-10), pairs that are usually steps (Yasha into
 * Manta Style, Maelstrom into Mjollnir, Dragon Lance into Hurricane Pike, Kaya into Kaya and Sange) are 12
 * minutes or more apart in about 10% of slices or fewer; held parts sit further apart (Diffusal Blade 20 minutes before
 * Disperser, Witch Blade 17 before Parasma, Blink Dagger 14 before Swift Blink).
 */
export const PART_HELD_MINUTES = 12;

/**
 * The slice's items with each part and the item built from it taking one place, all the way down (Dagon is
 * part of Dagon 3 through Dagon 2 even when the slice has no Dagon 2):
 * - bought soon before it (Yasha before Manta Style), the part is only a step and the built item stays;
 * - held PART_HELD_MINUTES or more before every item built from it, the more bought of the two stays
 *   (Slark's Diffusal Blade over Disperser).
 * Two items for one place would push out other items (Black King Bar) from a build of a few slots.
 */
export function finishedItems(slice: ItemTimingSlice, items: Record<string, ItemInfo>): ItemTimingSlice["items"] {
  // The slice lists items most bought first.
  const order = new Map(slice.items.map(([id, minute], i) => [id, { minute, rank: i }]));
  /** Every part of an item in the slice with the item built from it. */
  const pairs: { part: number; built: number }[] = [];
  for (const [built] of slice.items) {
    const seen = new Set<number>();
    const addParts = (of: number) => {
      for (const part of items[of]?.components ?? []) {
        if (seen.has(part)) continue;
        seen.add(part);
        if (order.has(part)) pairs.push({ part, built });
        addParts(part);
      }
    };
    addParts(built);
  }
  // Pairs hold only items of the slice, so the fallback never applies.
  const at = (id: number) => order.get(id) ?? { minute: 0, rank: 0 };
  const held = (p: { part: number; built: number }) => at(p.built).minute - at(p.part).minute >= PART_HELD_MINUTES;
  const partFirst = (p: { part: number; built: number }) => at(p.part).rank < at(p.built).rank;
  // A step into any item (Dagon into Dagon 2) gives way even when a later level comes much later, and so does
  // a held part less bought than what it builds into.
  const steps = new Set(pairs.filter((p) => !held(p) || !partFirst(p)).map((p) => p.part));
  const outbought = new Set(pairs.filter((p) => !steps.has(p.part)).map((p) => p.built));
  return slice.items.filter(([id]) => !steps.has(id) && !outbought.has(id));
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
