/**
 * Which item questions one draft asks (item journey plan, PR 9b), shared by the report and, later, the card.
 *
 * Slots come from the games themselves, not the weekly list (which holds alternatives side by side):
 * slot N's minute is the median time the games bought their Nth big item, A is the item most of them bought
 * there, and B the next most bought item of a similar cost. A cheap item against an expensive one would
 * mostly measure farm, not the item. The fallback asks about the Story's key item (game-plan.ts keyItem) once
 * it is late, so the card and the report ask the same thing.
 */
import { bigItems, fallbackOdds, type ItemGame, type ItemOdds, slotItem, slotOdds, WINDOW } from "./item-odds";

/** Slots asked about: the first few big items, where builds still differ by draft. */
export const SLOTS = 4;
/** B's cost must be within this factor of A's. */
export const COST_RATIO = 1.5;

interface Asked {
  /** The minute the game state is read at. */
  minute: number;
  ask: (games: ItemGame[]) => ItemOdds;
}

/** The usual item `a` against the other one `b` as the Nth big item. */
export interface SlotQuestion extends Asked {
  kind: "slot";
  slot: number;
  a: number;
  b: number;
}

/** Switching against keeping going once the key item is late. */
export interface FallbackQuestion extends Asked {
  kind: "fallback";
  key: number;
}

export type ItemQuestion = SlotQuestion | FallbackQuestion;

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
): SlotQuestion[] {
  const games = all.filter((g) => g.lead.length > 0);
  const out: SlotQuestion[] = [];
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

/** The fallback question for the Story's key item, when the build knows its late minute. */
export function fallbackQuestion(
  key: { itemId: number; lateMinute?: number } | undefined,
  isBig: (id: number) => boolean,
): FallbackQuestion | undefined {
  if (!key || key.lateMinute === undefined || !isBig(key.itemId)) return undefined;
  const late = Math.round(key.lateMinute);
  return { kind: "fallback", minute: late, key: key.itemId, ask: (g) => fallbackOdds(g, key.itemId, late, isBig) };
}
