/**
 * What each shop item does, so an answer item is chosen from mechanics, never from a hand-picked item: which
 * dispel it applies and to whom, whether it keeps dispelling, whether it makes an enemy invulnerable, and
 * whether it adds attack damage or speed. Generated from OpenDota's item constants (data-item-facts.ts,
 * `npm run item-facts`).
 */
import { ITEM_FACTS } from "./data-item-facts";

/** Who an item's dispel can reach. */
export type Reach = "enemy" | "self" | "ally";

export interface ItemFact {
  /** The dispel the item applies, from "Dispel Type" in its ability text. */
  dispel?: "basic" | "strong";
  /** Who the dispel can reach. */
  reaches?: readonly Reach[];
  /** It keeps dispelling for a while ("Continuously dispels"), so a recast buff is removed again. */
  repeats?: boolean;
  /** Used on an enemy it makes them invulnerable, so you can't hit them meanwhile. */
  invulnerableTarget?: boolean;
  /** It triggers by itself (passive), so it can't be used when you choose. */
  passive?: boolean;
  /** It adds attack damage, attack speed, critical strikes or bashes. */
  attack?: boolean;
}

/** The facts for one item by OpenDota key, or an empty fact for an item with none. */
export function itemFact(key: string): ItemFact {
  return ITEM_FACTS[key] ?? {};
}

/** Whether the item dispels an enemy you aim it at, leaving them hittable. */
export function dispelsEnemy(key: string): boolean {
  const f = itemFact(key);
  return f.dispel !== undefined && f.passive !== true && (f.reaches ?? []).includes("enemy") && f.invulnerableTarget !== true;
}
