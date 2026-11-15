/**
 * "If it goes wrong" lines for the Game Story. The site cannot see the live game, so each line starts from a
 * situation the player recognises themselves ("No Blink Dagger by 20 min?") and answers it with what high-rank
 * wins measured in that situation. A situation with no measurement gets no line: the hand-written lines for a
 * lost lane, a free enemy carry or being behind or ahead at 20 said the same thing in every game, so they were
 * removed (Can, 2026-11-15: no generic Game Story lines).
 */

import type { ItemInfo, PathStep } from "./types";

/** The situations a fallback line answers. Only a late key item has measured answers so far. */
export type Situation = "keyItemLate";

/** What the late key item line needs: the item, its late minute and what the late high-rank wins bought next. */
export interface LateItemFacts {
  /** The key item's name, like "Blink Dagger". */
  item: string;
  /** The minute after which the key item counts as late. */
  late: number;
  /** The late group: high-rank wins still running at `late` without the key item. */
  games: number;
  /** What the late group bought, the first step where it leaves the build first. */
  steps: PathStep[];
}

/**
 * "No Blink Dagger by 20 min? 31 of 48 high-rank wins without it bought Witch Blade next, around 18 min." from the
 * hero's guide games, or null when no game measured the path (a path with no steps, or an item with no name).
 */
export function keyItemLateLine(facts: LateItemFacts, items: Record<string, ItemInfo> | undefined): string | null {
  const [itemId, minute, games] = facts.steps[0] ?? [];
  const next = itemId !== undefined ? items?.[itemId]?.name : undefined;
  if (!next || minute === undefined || games === undefined || facts.games <= 0) return null;
  return `No ${facts.item} by ${facts.late} min? ${games} of ${facts.games} high-rank wins without it bought ${next} next, around ${minute} min.`;
}
