/**
 * Items Valve took out of the game. OpenDota's item list keeps removed items, and STRATZ and OpenDota count purchases
 * over rolling windows that reach back past a new patch, so for a while after a patch the builds still hold items
 * nobody can buy (7.42: Helm of the Overlord in offlane Beastmaster's core, Khanda in mid Rubick's, Javelin in 20
 * heroes' early items). Each refresh drops them from every item source of the snapshot.
 *
 * Which items are gone comes from the game's own item file, where Valve marks each one "IsObsolete" "1" and keeps
 * the block, so a patch's removals (letter patches too) are picked up on the next refresh with no list to keep.
 */
import type { Snapshot } from "../engine/types";
import { abilityIds, ABILITY_IDS_FILE, GAME_FILES_URL, parseKV, type KV } from "./talent-texts";

export const ITEMS_FILE = "scripts/npc/items.txt";

/**
 * Fewer removed items than this means the file was cut short or changed shape: 7.42a's file marks 22 items, and the
 * number only grows.
 */
export const MIN_REMOVED_ITEMS = 10;

/**
 * Ids of the items the item file marks obsolete, recipes left out (a recipe can go while its item stays, like
 * Medallion of Courage's). By id from the game's id file, not by name, since the timings are kept by id.
 */
export function obsoleteItemIds(items: KV, ids: KV): number[] {
  const byName = abilityIds(ids);
  const out = new Set<number>();
  const walk = (node: KV) => {
    for (const [name, block] of Object.entries(node)) {
      if (typeof block !== "object") continue;
      if (name.startsWith("item_") && !name.startsWith("item_recipe_")) {
        const id = byName.get(name);
        if (block.IsObsolete === "1" && id !== undefined) out.add(id);
      } else walk(block);
    }
  };
  walk(items);
  return [...out].sort((a, b) => a - b);
}

/** Downloads the item and id files and returns the removed items' ids. Throws when the list looks cut short. */
export async function fetchRemovedItems(getText: (url: string) => Promise<string>): Promise<number[]> {
  const [items, ids] = await Promise.all([ITEMS_FILE, ABILITY_IDS_FILE].map((f) => getText(`${GAME_FILES_URL}${f}`)));
  const removed = obsoleteItemIds(parseKV(items!), parseKV(ids!));
  if (removed.length < MIN_REMOVED_ITEMS) throw new Error(`only ${removed.length} removed items found`);
  return removed;
}

/** Ids of the items removed from the game, as the last read of the item file found them. */
export function removedItemIds(snapshot: Pick<Snapshot, "removedItems">): Set<number> {
  return new Set(snapshot.removedItems ?? []);
}

/**
 * Drops removed items from the item list, OpenDota's item popularity, STRATZ's timings, starts and
 * boots, and the guide games' late paths. Returns the removed ids the snapshot still held.
 */
export function dropRemovedItems(snapshot: Snapshot): number[] {
  const removed = removedItemIds(snapshot);
  const found = new Set<number>();
  const isRemoved = (id: number) => {
    if (!removed.has(id)) return false;
    found.add(id);
    return true;
  };
  const keep = <T extends readonly [number, ...unknown[]]>(rows: T[]) => rows.filter(([id]) => !isRemoved(id));
  const dropKeys = (counts: Record<string, unknown>) => {
    for (const id of Object.keys(counts)) if (isRemoved(Number(id))) delete counts[id];
  };
  if (removed.size === 0) return [];

  if (snapshot.items) dropKeys(snapshot.items);
  for (const phases of Object.values(snapshot.itemBuilds ?? {})) Object.values(phases).forEach(dropKeys);
  for (const byPosition of Object.values(snapshot.itemTimings ?? {})) {
    for (const bySlice of Object.values(byPosition)) {
      for (const slice of Object.values(bySlice)) {
        if (!slice) continue;
        slice.items = keep(slice.items);
        if (slice.lane) slice.lane = keep(slice.lane);
        if (slice.shares) slice.shares = keep(slice.shares);
        // The pace line follows one key item; a removed key item says nothing about this patch.
        if (slice.pace && isRemoved(slice.pace.itemId)) delete slice.pace;
      }
    }
  }
  for (const byPosition of Object.values(snapshot.itemStarts ?? {})) {
    for (const start of Object.values(byPosition)) {
      start.start = keep(start.start);
      start.boots = keep(start.boots);
    }
  }
  for (const byPosition of Object.values(snapshot.skillBuilds ?? {})) {
    for (const slice of Object.values(byPosition)) {
      if (!slice?.itemPaths) continue;
      dropKeys(slice.itemPaths);
      for (const paths of Object.values(slice.itemPaths)) {
        if (!paths.path) continue;
        paths.path.steps = keep(paths.path.steps);
        if (paths.path.steps.length === 0) delete paths.path;
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}
