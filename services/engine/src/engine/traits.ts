import type { HeroInfo } from "./types";

/**
 * Heroes that can save an ally from a gank. OpenDota has no role for this,
 * so the list is kept by hand. Matched by display name.
 */
const SAVE_HEROES = new Set([
  "Abaddon",
  "Dazzle",
  "Earth Spirit",
  "Io",
  "Marci",
  "Omniknight",
  "Oracle",
  "Outworld Destroyer",
  "Shadow Demon",
  "Vengeful Spirit",
  "Winter Wyvern",
  "Chen",
  "Bane",
  "Disruptor",
]);

export type Need = "disable" | "initiation" | "save" | "durable" | "push" | "magicDamage" | "physicalDamage";

export const NEED_LABELS: Record<Need, string> = {
  disable: "adds a stun or disable your team lacks",
  initiation: "gives your team an initiator",
  save: "gives your team a save",
  durable: "adds a tanky frontliner",
  push: "helps your team push and clear waves",
  magicDamage: "adds magic damage to an all-physical team",
  physicalDamage: "adds right-click damage to a magic-heavy team",
};

export function traitsOf(hero: HeroInfo): Set<Need> {
  const t = new Set<Need>();
  if (hero.roles.includes("Disabler")) t.add("disable");
  if (hero.roles.includes("Initiator")) t.add("initiation");
  if (hero.roles.includes("Durable")) t.add("durable");
  if (hero.roles.includes("Pusher")) t.add("push");
  if (hero.roles.includes("Nuker")) t.add("magicDamage");
  if (hero.roles.includes("Carry")) t.add("physicalDamage");
  if (SAVE_HEROES.has(hero.name)) t.add("save");
  return t;
}

/** How many heroes on a finished team should have each trait. */
const WANTED: Record<Need, number> = {
  disable: 2,
  initiation: 1,
  save: 1,
  durable: 1,
  push: 1,
  magicDamage: 1,
  physicalDamage: 1,
};

/** Needs the allies picked so far do not cover yet. */
export function unmetNeeds(allies: HeroInfo[]): Need[] {
  const counts = new Map<Need, number>();
  for (const ally of allies) for (const t of traitsOf(ally)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return (Object.keys(WANTED) as Need[]).filter((need) => (counts.get(need) ?? 0) < WANTED[need]);
}
