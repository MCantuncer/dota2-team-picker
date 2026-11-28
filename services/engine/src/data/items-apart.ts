/**
 * Big items players of a hero and position rarely hold in the same game: two routes, not two steps of one build.
 *
 * STRATZ counts each item on its own (item-timings.ts), and the build takes the most bought items, each at its own
 * average minute. When a hero has two routes, both end up in one build: Weaver carry showed Maelstrom at 15 and
 * Desolator at 17, about 10,500 gold of items by minute 18, while of the saved 7.42 Weaver games with either, 52 had
 * Desolator only, 26 Maelstrom (or Mjollnir, Gleipnir) only and 17 both. Across 170 hero positions with 40+ saved
 * games, 61 had such a pair in the build before minute 25.
 *
 * From the saved ranked games of this patch (eval-matches.ts: final items, and every finished item bought in parsed
 * games), this finds each hero position's pairs of big items that fewer than APART_SHARE of the games with either hold
 * together. An item counts as held when the player had it or an item built from it (Mjollnir holds Maelstrom). The
 * build then keeps the more bought one of a pair and names the other as its "or" (item-build.ts). Rebuilt every run.
 */
import type { EvalMatch } from "./eval-matches";
import type { ItemInfo, Snapshot } from "../engine/types";

/** Games a hero position needs with items before its pairs are judged. */
export const MIN_GAMES = 40;
/** Games with either item a pair needs to be judged. */
export const MIN_PAIR_GAMES = 20;
/** A pair held together in fewer than this share of the games with either is two routes. */
export const APART_SHARE = 0.25;
/** Items from this cost are judged: the ones that make a route (item-build.ts KEY_ITEM_MIN_COST). */
const MIN_COST = 2000;
/** Items held in fewer than this share of a hero position's games are no route of it. */
const MIN_HELD_SHARE = 0.08;
/** Items used up when bought (never in the final slots) or boots, which every build has one of. */
const SKIPPED = new Set([
  "aghanims_shard", "moon_shard", "ultimate_scepter_2", "tome_of_knowledge", "cheese",
  "phase_boots", "power_treads", "arcane_boots", "tranquil_boots", "boots", "travel_boots", "travel_boots_2",
  "guardian_greaves", "boots_of_bearing",
]);

/** For each item id, itself and every item built from it, over any number of steps. */
export function upgradesOf(items: Record<string, ItemInfo>): Map<number, Set<number>> {
  const parents = new Map<number, number[]>();
  for (const [id, item] of Object.entries(items)) {
    for (const part of item.components ?? []) parents.set(part, [...(parents.get(part) ?? []), Number(id)]);
  }
  const out = new Map<number, Set<number>>();
  const walk = (id: number, seen: Set<number>) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const p of parents.get(id) ?? []) walk(p, seen);
  };
  for (const id of Object.keys(items).map(Number)) {
    const seen = new Set<number>();
    walk(id, seen);
    out.set(id, seen);
  }
  return out;
}

/**
 * itemsApart[heroId][position]: the pairs [more held, less held, percent held together] of big items rarely held
 * together, from the games of this patch. Hero positions with fewer than MIN_GAMES games with items are left out.
 */
export function findItemsApart(games: EvalMatch[], items: Record<string, ItemInfo>, patchStart: number): NonNullable<Snapshot["itemsApart"]> {
  const upgrades = upgradesOf(items);
  const judged = (id: number) => {
    const item = items[id];
    return !!item && item.cost >= MIN_COST && !SKIPPED.has(item.key);
  };
  const byHero = new Map<string, Set<number>[]>();
  for (const g of games) {
    if (g.startTime < patchStart) continue;
    for (const p of g.picks) {
      if (!p.position || !p.items?.length) continue;
      const owned = new Set<number>([...p.items, ...(p.buys ?? []).map(([id]) => id)]);
      const key = `${p.heroId}:${p.position}`;
      byHero.set(key, [...(byHero.get(key) ?? []), owned]);
    }
  }
  const out: NonNullable<Snapshot["itemsApart"]> = {};
  for (const [key, inventories] of byHero) {
    if (inventories.length < MIN_GAMES) continue;
    // An item is held when the inventory has it or one of its upgrades.
    const held = (inv: Set<number>, id: number) => [...(upgrades.get(id) ?? [id])].some((u) => inv.has(u));
    const candidates = new Set<number>();
    for (const inv of inventories) for (const id of inv) for (const part of [id, ...(items[id]?.components ?? [])]) if (judged(part)) candidates.add(part);
    const holders = new Map<number, Set<number>>();
    for (const id of candidates) {
      const games = new Set<number>();
      inventories.forEach((inv, i) => held(inv, id) && games.add(i));
      if (games.size >= Math.max(MIN_PAIR_GAMES / 2, inventories.length * MIN_HELD_SHARE)) holders.set(id, games);
    }
    const ids = [...holders.keys()].sort((a, b) => holders.get(b)!.size - holders.get(a)!.size || a - b);
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [ids[i]!, ids[j]!];
        // An item and its own upgrade (Maelstrom and Mjollnir) are one route.
        if (upgrades.get(a)?.has(b) || upgrades.get(b)?.has(a)) continue;
        const A = holders.get(a)!;
        const B = holders.get(b)!;
        let both = 0;
        for (const g of A) if (B.has(g)) both++;
        const either = A.size + B.size - both;
        if (either >= MIN_PAIR_GAMES && both / either < APART_SHARE) pairs.push([a, b, Math.round((both / either) * 100)]);
      }
    }
    if (!pairs.length) continue;
    const [hero, position] = key.split(":") as [string, string];
    (out[hero] ??= {})[position] = pairs;
  }
  return out;
}
