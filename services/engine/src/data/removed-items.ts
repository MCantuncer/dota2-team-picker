/**
 * Items Valve took out of the game, by the patch that removed them. OpenDota's item list keeps removed
 * items, and STRATZ and OpenDota count purchases over rolling windows that reach back past a new patch,
 * so for a while after a patch the builds still hold items nobody can buy (7.42: Helm of the Overlord in
 * offlane Beastmaster's core, Khanda in mid Rubick's, Javelin in 20 heroes' early items). Each refresh
 * drops them from every item source of the snapshot. A fact from the patch notes, not a judgment of
 * which items are good, so the list only grows when a patch removes items.
 */
import type { Snapshot } from "../engine/types";

/**
 * By patch, item id to OpenDota key. By id, not by key: the item list is downloaded once a day and the
 * other sources on their own days, so a run can hold a removed item's timings after its list entry is gone.
 */
export const REMOVED_ITEMS: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  "7.42": { 7: "javelin", 1808: "angels_demise", 635: "helm_of_the_overlord" },
};

/** "7.42" as [7, 42], so 7.100 sorts after 7.99. Letters ("7.41c") are ignored. */
function patchParts(name: string): number[] {
  return name.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

/** Whether patch `a` is `b` or later. */
export function patchAtLeast(a: string, b: string): boolean {
  const [pa, pb] = [patchParts(a), patchParts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/** Ids of the items removed in the snapshot's patch or earlier. */
export function removedItemIds(snapshot: Pick<Snapshot, "patch">): Set<number> {
  const patch = snapshot.patch?.name;
  if (!patch) return new Set();
  return new Set(
    Object.entries(REMOVED_ITEMS).flatMap(([removedIn, byId]) => (patchAtLeast(patch, removedIn) ? Object.keys(byId).map(Number) : [])),
  );
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
