/**
 * Shop items and how often each hero buys them, from the free OpenDota API, for the item
 * builds in the game plan. One request for the item list, then one per hero for its item
 * popularity, so they are refreshed once a day rather than on every run.
 */
import type { ItemInfo, ItemPhases, Snapshot } from "../engine/types";

const ITEMS_MAX_AGE_DAYS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Items kept per hero and phase; the rest are rare buys that never make a build. */
const TOP_PER_PHASE = 15;
const PHASES = ["start", "early", "mid", "late"] as const;

/** One entry of OpenDota's /constants/items, keyed by internal name. */
export interface ItemConstantRow {
  id?: unknown;
  dname?: unknown;
  cost?: unknown;
  img?: unknown;
  components?: unknown;
}

/** OpenDota's /heroes/{id}/itemPopularity: times bought per item id in each phase. */
export type ItemPopularityRow = Partial<Record<`${(typeof PHASES)[number]}_game_items`, Record<string, unknown>>>;

export function itemsDue(snapshot: Snapshot, now: Date): boolean {
  if (!snapshot.itemsAt || !snapshot.items || !snapshot.itemBuilds) return true;
  return now.getTime() - Date.parse(snapshot.itemsAt) >= ITEMS_MAX_AGE_DAYS * DAY_MS;
}

/** Turns OpenDota's item constants into items by id, dropping recipes and free items. */
export function toItems(rows: Record<string, ItemConstantRow>): Record<string, ItemInfo> {
  const idByKey = new Map<string, number>();
  for (const [key, row] of Object.entries(rows)) if (typeof row.id === "number") idByKey.set(key, row.id);
  const items: Record<string, ItemInfo> = {};
  for (const [key, row] of Object.entries(rows)) {
    if (key.startsWith("recipe_") || typeof row.id !== "number" || typeof row.dname !== "string") continue;
    if (typeof row.cost !== "number" || row.cost <= 0) continue;
    const components = Array.isArray(row.components) ? row.components : [];
    items[row.id] = {
      key,
      name: row.dname,
      cost: row.cost,
      // Drop the cache-busting query, the path is enough.
      img: typeof row.img === "string" ? row.img.replace(/\?.*$/, "") : "",
      components: components.flatMap((c) => {
        const id = typeof c === "string" ? idByKey.get(c) : undefined;
        return id === undefined ? [] : [id];
      }),
    };
  }
  return items;
}

/** Keeps the most bought known items of each phase. */
export function toItemPhases(row: ItemPopularityRow, items: Record<string, ItemInfo>): ItemPhases {
  const top = (phase: (typeof PHASES)[number]) =>
    Object.fromEntries(
      Object.entries(row[`${phase}_game_items`] ?? {})
        .flatMap(([id, n]) => (items[id] && typeof n === "number" && n > 0 ? [[id, n] as const] : []))
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_PER_PHASE),
    );
  return { start: top("start"), early: top("early"), mid: top("mid"), late: top("late") };
}

/** Downloads the item list and every hero's item popularity into the snapshot. */
export async function fetchItems(snapshot: Snapshot, get: <T>(path: string) => Promise<T>, now: Date) {
  const items = toItems(await get<Record<string, ItemConstantRow>>("/constants/items"));
  const builds: Record<string, ItemPhases> = {};
  for (const id of Object.keys(snapshot.heroes)) {
    builds[id] = toItemPhases(await get<ItemPopularityRow>(`/heroes/${id}/itemPopularity`), items);
  }
  snapshot.items = items;
  snapshot.itemBuilds = builds;
  snapshot.itemsAt = now.toISOString();
}
