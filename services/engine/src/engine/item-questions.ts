/**
 * Which item questions one draft asks (item journey plan, PR 9b), shared by the report and, later, the card.
 *
 * Slots come from the games themselves, not the weekly list (which holds alternatives side by side):
 * slot N's minute is the median time the games bought their Nth big item, A is the item most of them bought
 * there, and B the next most bought item of a similar cost. A cheap item against an expensive one would
 * mostly measure farm, not the item. The fallback asks about the first big item of the high-rank weekly build
 * that has a late minute.
 */
import { bigItems, fallbackOdds, type ItemGame, type ItemOdds, slotItem, slotOdds, WINDOW } from "./item-odds";
import type { ItemTimingSlice } from "./types";

/** Slots asked about: the first few big items, where builds still differ by draft. */
export const SLOTS = 4;
/** B's cost must be within this factor of A's. */
export const COST_RATIO = 1.5;

export interface ItemQuestion {
  kind: "slot" | "fallback";
  /** The minute the game state is read at. */
  minute: number;
  /** Slot: the usual item and the other one. Fallback: a is the key item, b is unused (0). */
  slot: number;
  a: number;
  b: number;
  ask: (games: ItemGame[]) => ItemOdds;
}

function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((x, y) => x - y);
  // s has at least one entry.
  return s[(s.length - 1) >> 1]!;
}

function mostBought(counts: Map<number, number>): number | undefined {
  // Ties go to the lower id, so the same games always ask the same question.
  return [...counts].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0];
}

/** The slot questions the games can ask. Games without a lead are left out, as the odds can't use them. */
export function slotQuestions(
  all: ItemGame[],
  isBig: (id: number) => boolean,
  cost: (id: number) => number | undefined,
): ItemQuestion[] {
  const games = all.filter((g) => g.lead.length > 0);
  const out: ItemQuestion[] = [];
  for (let slot = 1; slot <= SLOTS; slot++) {
    const at = median(games.map((g) => bigItems(g, isBig)[slot - 1]?.[1]).filter((t) => t !== undefined));
    if (at === undefined) break;
    const minute = Math.max(Math.floor(at / 60) - WINDOW / 2, 0);
    const counts = new Map<number, number>();
    for (const g of games) {
      const id = slotItem(g, slot, minute, isBig);
      if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const a = mostBought(counts);
    const costA = a === undefined ? undefined : cost(a);
    if (a === undefined || costA === undefined) continue;
    counts.delete(a);
    for (const id of [...counts.keys()]) {
      const c = cost(id);
      if (c === undefined || c > costA * COST_RATIO || c * COST_RATIO < costA) counts.delete(id);
    }
    const b = mostBought(counts);
    if (b === undefined) continue;
    const q = { slot, minute, a, b };
    out.push({ kind: "slot", ...q, ask: (g) => slotOdds(g, q, isBig) });
  }
  return out;
}

/** The fallback question for the weekly build's first big item with a late minute, if any. */
export function fallbackQuestion(build: ItemTimingSlice | undefined, isBig: (id: number) => boolean): ItemQuestion | undefined {
  const key = build?.items.find(([id, minute, late]) => isBig(id) && late > minute);
  if (!key) return undefined;
  const late = Math.round(key[2]);
  return { kind: "fallback", minute: late, slot: 0, a: key[0], b: 0, ask: (g) => fallbackOdds(g, key[0], late, isBig) };
}
