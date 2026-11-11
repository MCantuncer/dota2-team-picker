/**
 * When players buy their core items, per hero, position and rank group, from STRATZ, for the item
 * minutes in the Game Story. STRATZ counts every purchase by the minute it happened, with wins, so
 * each item gets its average minute and the minute after which buying it is slower than most.
 *
 * About 1,500 slices (each hero's main positions, four rank groups and all ranks) fit in about
 * 25 batched queries, so they are refreshed once a day like the item builds.
 */
import { isConsumable, isCoreItem } from "../engine/item-build";
import { SHARE_MIN } from "../engine/item-trends";
import type { ItemInfo, ItemTimingSlice, ItemTimingSliceKey, Position, RankGroup, Snapshot } from "../engine/types";

const ITEM_TIMINGS_MAX_AGE_DAYS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
/** STRATZ answered 60 aliases in one query in about 0.6 seconds (Nov 2026 test). */
export const SLICES_PER_QUERY = 60;
/**
 * Positions per hero to fetch: the two most played, plus a third played in at least
 * FLEX_POSITION_SHARE of games, so a flex pick like carry Vengeful Spirit (1 game in 5) gets real
 * pos 1 minutes. Rarer positions rarely have data.
 */
const POSITIONS_PER_HERO = 2;
const MAX_POSITIONS_PER_HERO = 3;
export const FLEX_POSITION_SHARE = 0.15;
/** Core items kept per slice; more than a build shows, so the engine can drop components. */
const ITEMS_PER_SLICE = 10;
/** A small item is a lane item when this share of the slice's games buy it... */
const LANE_SHARE = 0.25;
/** ...by this minute on average. */
const LANE_LAST_MINUTE = 12;
/** Lane items kept per slice. */
const LANE_ITEMS_PER_SLICE = 4;
/** Items from this cost, bought in SHARE_MIN of games, are kept in `shares`: lane items like Soul Ring too, not Magic Wand. */
export const SHARE_MIN_COST = 500;
/** A minute counts as slower than most when its win rate is this far under the item's own. */
const WIN_DROP = 0.05;
/** Ignore minutes with less than this share of the item's purchases: too few games to trust. */
const MIN_MINUTE_SHARE = 0.01;
/** Look for the win drop up to this many minutes past the 75th percentile. */
const LATE_SEARCH_AFTER_P75 = 5;

/** STRATZ's names for our rank groups (see RANK_GROUP_BRACKETS). */
const STRATZ_BRACKETS: Record<RankGroup, string> = {
  1: "HERALD_GUARDIAN",
  2: "CRUSADER_ARCHON",
  3: "LEGEND_ANCIENT",
  4: "DIVINE_IMMORTAL",
};
const SLICE_KEYS: ItemTimingSliceKey[] = ["all", "1", "2", "3", "4"];

/** One hero, position and rank slice to ask STRATZ about. */
export interface TimingRequest {
  heroId: number;
  position: Position;
  slice: ItemTimingSliceKey;
}

/** One row of STRATZ's itemFullPurchase: how often an item was bought at one minute. */
export interface PurchaseRow {
  itemId: number;
  /** 0 for the first copy of an item, 1 for a second copy. */
  instance: number;
  /** Minute of the game. */
  time: number;
  matchCount: number;
  winCount: number;
}

export function itemTimingsDue(snapshot: Snapshot, now: Date): boolean {
  // Start items are fetched with the timings, so a snapshot without them is due too.
  if (!snapshot.itemTimingsAt || !snapshot.itemTimings || !snapshot.itemStarts) return true;
  return now.getTime() - Date.parse(snapshot.itemTimingsAt) >= ITEM_TIMINGS_MAX_AGE_DAYS * DAY_MS;
}

/** Each hero's most played positions with games, from the STRATZ positions in the snapshot. */
export function timingRequests(positions: NonNullable<Snapshot["positions"]>): TimingRequest[] {
  return Object.entries(positions).flatMap(([id, games]) => {
    const total = games.reduce((a, b) => a + b, 0);
    return games
      .map((g, i) => ({ position: (i + 1) as Position, games: g })) // Index 0 to 4 is pos 1 to 5.
      .filter((p) => p.games > 0)
      .sort((a, b) => b.games - a.games)
      .filter((p, rank) => rank < POSITIONS_PER_HERO || p.games >= total * FLEX_POSITION_SHARE)
      .slice(0, MAX_POSITIONS_PER_HERO)
      .flatMap(({ position }) => SLICE_KEYS.map((slice) => ({ heroId: Number(id), position, slice })));
  });
}

/** One query with an alias (s0, s1, ...) per request. */
export function itemTimingsQuery(requests: TimingRequest[]): string {
  if (requests.length === 0 || requests.length > SLICES_PER_QUERY) {
    throw new Error(`Expected 1 to ${SLICES_PER_QUERY} slices, got ${requests.length}`);
  }
  const lines = requests.map((r, i) => {
    if (!Number.isSafeInteger(r.heroId)) throw new Error(`Bad hero id ${r.heroId}`);
    // Every slice key but "all" is a rank group, "1" to "4".
    const bracket = r.slice === "all" ? "" : `, bracketBasicIds: [${STRATZ_BRACKETS[Number(r.slice) as RankGroup]}]`;
    return `    s${i}: itemFullPurchase(heroId: ${r.heroId}, positionIds: [POSITION_${r.position}]${bracket}) { itemId instance time matchCount winCount }`;
  });
  return `{\n  heroStats {\n${lines.join("\n")}\n  }\n}`;
}

/** Keeps the rows that have the expected shape; STRATZ is a third party. */
function validRows(rows: unknown): PurchaseRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is PurchaseRow =>
      typeof r === "object" &&
      r !== null &&
      ["itemId", "instance", "time", "matchCount", "winCount"].every((k) => typeof (r as Record<string, unknown>)[k] === "number"),
  );
}

/**
 * The minute after which a player is slower than most: the first minute past the average where the
 * item's win rate is WIN_DROP under its own, or else the 75th percentile minute. Always after `minute`.
 */
export function lateMinute(rows: PurchaseRow[], minute: number): number {
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  const games = sorted.reduce((n, r) => n + r.matchCount, 0);
  const winRate = sorted.reduce((n, r) => n + r.winCount, 0) / games;
  let seen = 0;
  const p75 = sorted.find((r) => (seen += r.matchCount) >= 0.75 * games)?.time ?? minute;
  const drop = sorted.find(
    (r) =>
      r.time > minute &&
      r.time <= p75 + LATE_SEARCH_AFTER_P75 &&
      r.matchCount >= games * MIN_MINUTE_SHARE &&
      r.winCount / r.matchCount < winRate - WIN_DROP,
  );
  return Math.max(drop?.time ?? p75, minute + 1);
}

/**
 * Turns one slice's purchase rows into its most bought core and lane items with their minutes, or null when
 * empty. `withShares` adds every lasting item's purchase count (ItemTimingSlice.shares).
 */
export function toTimingSlice(rows: PurchaseRow[], items: Record<string, ItemInfo>, withShares = false): ItemTimingSlice | null {
  const byItem = new Map<number, PurchaseRow[]>();
  for (const r of rows) {
    // A second copy (instance 1) is a different purchase, like a second Wraith Band.
    if (r.instance !== 0 || r.matchCount <= 0) continue;
    byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  }
  const counted = [...byItem].map(([id, list]) => ({ id, list, games: list.reduce((n, r) => n + r.matchCount, 0) }));
  if (counted.length === 0) return null;
  const games = Math.max(...counted.map((c) => c.games));
  const averageMinute = (list: PurchaseRow[], n: number) => list.reduce((sum, r) => sum + r.time * r.matchCount, 0) / n;
  const top = counted
    .filter((c) => isCoreItem(items[c.id]))
    .sort((a, b) => b.games - a.games)
    .slice(0, ITEMS_PER_SLICE)
    .map(({ id, list, games: bought }): ItemTimingSlice["items"][number] => {
      const minute = Math.round(averageMinute(list, bought));
      return [id, minute, lateMinute(list, minute)];
    });
  const lane = counted
    .filter((c) => items[c.id] && !isCoreItem(items[c.id]) && !isConsumable(items[c.id]) && c.games >= games * LANE_SHARE)
    .map((c) => ({ id: c.id, games: c.games, minute: averageMinute(c.list, c.games) }))
    .filter((c) => c.minute <= LANE_LAST_MINUTE)
    // The most bought, told in buy order.
    .sort((a, b) => b.games - a.games)
    .slice(0, LANE_ITEMS_PER_SLICE)
    .sort((a, b) => a.minute - b.minute)
    .map((c): [number, number] => [c.id, Math.round(c.minute)]);
  const shares = withShares
    ? counted
        .filter((c) => {
          const item = items[c.id];
          return item !== undefined && !isConsumable(item) && item.key !== "boots" && item.cost >= SHARE_MIN_COST && c.games >= games * SHARE_MIN;
        })
        .sort((a, b) => b.games - a.games || a.id - b.id)
        .map((c): [number, number] => [c.id, c.games])
    : [];
  return { games, items: top, ...(lane.length ? { lane } : {}), ...(shares.length ? { shares } : {}) };
}

/** Downloads item timings for every hero's main positions into the snapshot. */
export async function fetchItemTimings(
  snapshot: Snapshot,
  post: (query: string) => Promise<{ heroStats?: Record<string, unknown> | null }>,
  now: Date,
) {
  const items = snapshot.items;
  if (!snapshot.positions || !items) throw new Error("Item timings need positions and items first");
  const requests = timingRequests(snapshot.positions);
  const timings: NonNullable<Snapshot["itemTimings"]> = {};
  for (let i = 0; i < requests.length; i += SLICES_PER_QUERY) {
    const batch = requests.slice(i, i + SLICES_PER_QUERY);
    const stats = (await post(itemTimingsQuery(batch))).heroStats;
    if (!stats) throw new Error("STRATZ item timings failed: no heroStats in the answer");
    batch.forEach((r, j) => {
      const slice = toTimingSlice(validRows(stats[`s${j}`]), items, r.slice === "all");
      if (slice) ((timings[r.heroId] ??= {})[r.position] ??= {})[r.slice] = slice;
    });
  }
  snapshot.itemTimings = timings;
  snapshot.itemTimingsAt = now.toISOString();
}
