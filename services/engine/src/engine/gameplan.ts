import type { HeroInfo } from "./types";

/**
 * Hand-kept game plan knowledge for WCST: how a team wants to win (its style)
 * and well-known spell combos. Match data scores pairs of heroes, but it cannot
 * see a five-hero plan or a combo that only works when both spells land
 * together, so these lists add what players already know. Matched by display
 * name, like the save list in traits.ts.
 */

export type Style = "teamfight" | "push" | "pickoff" | "lategame";

export const STYLES: Record<Style, { label: string; plan: string; heroes: string[] }> = {
  teamfight: {
    label: "Teamfight",
    plan: "group up and win the big fights with your ultimates",
    heroes: [
      "Magnus", "Enigma", "Tidehunter", "Earthshaker", "Faceless Void", "Mars", "Dark Seer", "Puck",
      "Phoenix", "Warlock", "Kunkka", "Sand King", "Winter Wyvern", "Jakiro", "Disruptor", "Elder Titan",
      "Treant Protector", "Snapfire", "Invoker", "Sven", "Centaur Warrunner", "Axe", "Lich", "Necrophos",
      "Witch Doctor", "Primal Beast", "Dawnbreaker", "Queen of Pain", "Ember Spirit",
    ],
  },
  push: {
    label: "Push",
    plan: "take towers early and end before their carries are ready",
    heroes: [
      "Death Prophet", "Leshrac", "Shadow Shaman", "Nature's Prophet", "Lycan", "Broodmother", "Pugna",
      "Jakiro", "Chen", "Beastmaster", "Visage", "Venomancer", "Luna", "Drow Ranger", "Tiny",
      "Troll Warlord", "Dawnbreaker",
    ],
  },
  pickoff: {
    label: "Pick-off",
    plan: "catch heroes alone around the map and snowball the kills",
    heroes: [
      "Spirit Breaker", "Bounty Hunter", "Riki", "Nyx Assassin", "Night Stalker", "Clockwerk", "Pudge",
      "Bloodseeker", "Slardar", "Batrider", "Storm Spirit", "Queen of Pain", "Lion", "Shadow Shaman",
      "Mirana", "Earth Spirit", "Tusk", "Void Spirit", "Legion Commander", "Templar Assassin", "Lina",
      "Ember Spirit", "Ursa",
    ],
  },
  lategame: {
    label: "Late game",
    plan: "keep your carries farming safely and win the late fights",
    heroes: [
      "Spectre", "Medusa", "Anti-Mage", "Terrorblade", "Phantom Lancer", "Naga Siren", "Faceless Void",
      "Morphling", "Slark", "Arc Warden", "Alchemist", "Sniper", "Muerta", "Weaver", "Gyrocopter",
    ],
  },
};

/** Known combos: both heroes, and the spells that make it work. */
export const COMBOS: { heroes: [string, string]; text: string }[] = [
  { heroes: ["Magnus", "Sven"], text: "Reverse Polarity into Sven's God's Strength cleave" },
  { heroes: ["Enigma", "Queen of Pain"], text: "Black Hole into Sonic Wave" },
  { heroes: ["Faceless Void", "Witch Doctor"], text: "Chronosphere with Death Ward inside" },
  { heroes: ["Faceless Void", "Invoker"], text: "Chronosphere into Sun Strike and Chaos Meteor" },
  { heroes: ["Dark Seer", "Earthshaker"], text: "Vacuum into Echo Slam" },
  { heroes: ["Dark Seer", "Magnus"], text: "Vacuum into Reverse Polarity" },
  { heroes: ["Tidehunter", "Kunkka"], text: "Ravage into Ghostship and Torrent" },
  { heroes: ["Io", "Tiny"], text: "Relocate in, Toss and Avalanche" },
  { heroes: ["Io", "Gyrocopter"], text: "Tether and Overcharge on a Flak Cannon carry" },
  { heroes: ["Disruptor", "Sand King"], text: "Kinetic Field holds them inside Epicenter" },
  { heroes: ["Mars", "Snapfire"], text: "Arena of Blood with Mortimer Kisses inside" },
  { heroes: ["Winter Wyvern", "Jakiro"], text: "Winter's Curse inside Macropyre" },
  { heroes: ["Ogre Magi", "Troll Warlord"], text: "Bloodlust on Battle Trance" },
];

/** Heroes in each style, by id, built once per hero list. */
export function styleSets(heroes: HeroInfo[]): Record<Style, Set<number>> {
  const byName = new Map(heroes.map((h) => [h.name, h.id]));
  const sets = {} as Record<Style, Set<number>>;
  for (const style of Object.keys(STYLES) as Style[]) {
    sets[style] = new Set(STYLES[style].heroes.flatMap((n) => (byName.has(n) ? [byName.get(n)!] : [])));
  }
  return sets;
}

/** Combos by hero id pair ("a-b" with a < b). */
export function comboMap(heroes: HeroInfo[]): Map<string, string> {
  const byName = new Map(heroes.map((h) => [h.name, h.id]));
  const map = new Map<string, string>();
  for (const c of COMBOS) {
    const [a, b] = c.heroes.map((n) => byName.get(n));
    if (a !== undefined && b !== undefined) map.set(a < b ? `${a}-${b}` : `${b}-${a}`, c.text);
  }
  return map;
}
