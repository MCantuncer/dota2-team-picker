/**
 * Hard counters: one hero who, by a specific mechanic, makes another much worse. Reviewed by hand and
 * checked against 177k public matches (Oct 2026). `gap` is how many win-rate points worse `hero` does
 * when `counter` is on the enemy team. Ids are OpenDota hero ids; the names are there to read the list.
 * The refresh Action opens an issue to re-check this list after each patch.
 */
export interface HardCounter {
  hero: number;
  counter: number;
  gap: number;
  names: string;
}

export const HARD_COUNTERS: readonly HardCounter[] = [
  { hero: 94, counter: 1, gap: 11.8, names: "Medusa < Anti-Mage" },
  { hero: 61, counter: 7, gap: 9.8, names: "Broodmother < Earthshaker" },
  { hero: 59, counter: 47, gap: 9.1, names: "Huskar < Viper" },
  { hero: 102, counter: 68, gap: 8.2, names: "Abaddon < Ancient Apparition" },
  { hero: 82, counter: 7, gap: 7.6, names: "Meepo < Earthshaker" },
  { hero: 36, counter: 68, gap: 7.3, names: "Necrophos < Ancient Apparition" },
  { hero: 12, counter: 29, gap: 7.2, names: "Phantom Lancer < Tidehunter" },
  { hero: 1, counter: 2, gap: 6.5, names: "Anti-Mage < Axe" },
  { hero: 34, counter: 1, gap: 5.6, names: "Tinker < Anti-Mage" },
  { hero: 93, counter: 87, gap: 5.6, names: "Slark < Disruptor" },
  { hero: 99, counter: 47, gap: 5.5, names: "Bristleback < Viper" },
  { hero: 99, counter: 68, gap: 5.2, names: "Bristleback < Ancient Apparition" },
  { hero: 12, counter: 7, gap: 5.1, names: "Phantom Lancer < Earthshaker" },
  { hero: 76, counter: 88, gap: 4.8, names: "Outworld Devourer < Nyx Assassin" },
  { hero: 59, counter: 36, gap: 4.3, names: "Huskar < Necrophos" },
  { hero: 12, counter: 106, gap: 3.9, names: "Phantom Lancer < Ember Spirit" },
  { hero: 44, counter: 2, gap: 3.5, names: "Phantom Assassin < Axe" },
];

/** The hard counters of each hero, by hero id. */
export function hardCountersOf(list: readonly HardCounter[] = HARD_COUNTERS): Map<number, HardCounter[]> {
  const out = new Map<number, HardCounter[]>();
  for (const hc of list) out.set(hc.hero, [...(out.get(hc.hero) ?? []), hc]);
  return out;
}
