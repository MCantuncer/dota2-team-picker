/**
 * Hard counters: one hero who makes another much worse. The refresh finds them in the match data
 * for every hero (see data-hard-counters.ts) and stores them in the snapshot's `dataHardCounters`.
 * `gap` is how many win-rate points worse `hero` does when `counter` is on the enemy team. Ids are
 * OpenDota hero ids; the names are there to read the list.
 */
export interface HardCounter {
  hero: number;
  counter: number;
  gap: number;
  names: string;
}

/** The hard counters of each hero, by hero id. */
export function hardCountersOf(list: readonly HardCounter[]): Map<number, HardCounter[]> {
  const out = new Map<number, HardCounter[]>();
  for (const hc of list) out.set(hc.hero, [...(out.get(hc.hero) ?? []), hc]);
  return out;
}
