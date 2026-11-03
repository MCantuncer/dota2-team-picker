/**
 * Hard counters found in the match data, for every hero, next to the hand-checked list in
 * hard-counters.ts. A pair counts when the hero does at least MIN_GAP points worse than its and
 * the enemy's win rates predict (the engine's matchup edge, not the raw win rate) over at least
 * MIN_GAMES games at all ranks, and has done so on HOLD_RUNS refreshes in a row, so a pair near
 * the line does not flip on and off. Each hero keeps its PER_HERO worst.
 */
import type { HardCounter } from "./hard-counters";
import type { Snapshot } from "./types";

export const MIN_GAP = 5;
export const MIN_GAMES = 1000;
export const HOLD_RUNS = 2;
export const PER_HERO = 3;

/** What the engine needs to judge a pair. */
interface EdgeSource {
  heroes: { id: number; name: string }[];
  matchupEdge(a: number, b: number): number;
}

/** This run's pairs past the line, worst first per hero, before the hold. */
export function findHardCounters(engine: EdgeSource, data: Pick<Snapshot, "matchups">): HardCounter[] {
  const names = new Map(engine.heroes.map((h) => [h.id, h.name]));
  const out: HardCounter[] = [];
  for (const hero of engine.heroes) {
    const row = data.matchups[hero.id] ?? {};
    const found: HardCounter[] = [];
    for (const [key, gw] of Object.entries(row)) {
      const counter = Number(key);
      if (gw.games < MIN_GAMES || !names.has(counter)) continue;
      const edge = engine.matchupEdge(hero.id, counter);
      if (edge <= -MIN_GAP) found.push({ hero: hero.id, counter, gap: Math.round(-edge * 10) / 10, names: `${hero.name} < ${names.get(counter)}` });
    }
    out.push(...found.sort((a, b) => b.gap - a.gap).slice(0, PER_HERO));
  }
  return out;
}

/**
 * Updates the run streak of each pair and returns the pairs that held for HOLD_RUNS runs, with
 * this run's gap. Pairs that dropped out lose their streak.
 */
export function holdHardCounters(found: HardCounter[], streaks: Record<string, number> = {}): { list: HardCounter[]; streaks: Record<string, number> } {
  const next: Record<string, number> = {};
  for (const hc of found) next[`${hc.hero}-${hc.counter}`] = (streaks[`${hc.hero}-${hc.counter}`] ?? 0) + 1;
  return { list: found.filter((hc) => next[`${hc.hero}-${hc.counter}`]! >= HOLD_RUNS), streaks: next };
}

/** The hand-checked list plus the data's pairs it doesn't already have. */
export function mergeHardCounters(hand: readonly HardCounter[], fromData: readonly HardCounter[] = []): HardCounter[] {
  const known = new Set(hand.map((hc) => `${hc.hero}-${hc.counter}`));
  return [...hand, ...fromData.filter((hc) => !known.has(`${hc.hero}-${hc.counter}`))];
}
