/**
 * How each hero does by when its team picked it, counted from the saved ranked games.
 * A hero that wins less as a first pick than as a last pick is easy to counter, so it
 * is safer to pick later.
 */
import type { EvalMatch } from "./eval-matches";
import type { Snapshot } from "../engine/types";

export type PickPhaseCounts = NonNullable<Snapshot["pickPhase"]>;

/** 0 early (the team's 1st or 2nd pick), 1 middle (3rd), 2 late (4th or 5th). */
export function phaseOf(teamPickIndex: number): 0 | 1 | 2 {
  return teamPickIndex < 2 ? 0 : teamPickIndex === 2 ? 1 : 2;
}

/** Games and wins per hero and phase over the given games. */
export function countPickPhases(games: EvalMatch[]): PickPhaseCounts {
  const counts: PickPhaseCounts = {};
  for (const game of games) {
    const taken = { radiant: 0, dire: 0 };
    for (const pick of game.picks) {
      const side = pick.radiant ? "radiant" : "dire";
      const phase = phaseOf(taken[side]++);
      const row = (counts[pick.heroId] ??= { games: [0, 0, 0], wins: [0, 0, 0] });
      row.games[phase]!++;
      if (pick.radiant === game.radiantWin) row.wins[phase]!++;
    }
  }
  return counts;
}
