import type { RankBracket } from "../../src/engine/types";

/**
 * Golden drafts: real drafts across every rank group whose Game Story a strong player has read.
 * Their stories are saved in stories/<draft>.md, one file per draft, so any change to the story shows up there for review.
 * Our heroes are listed pos 1 to 5.
 */
export interface GoldenDraft {
  name: string;
  ours: number[];
  theirs: number[];
  rankBracket: RankBracket;
}

export const GOLDEN_DRAFTS: GoldenDraft[] = [
  // Juggernaut, Puck, Mars, Lion, Crystal Maiden vs Phantom Assassin, Shadow Fiend, Axe, Witch Doctor, Lich.
  { name: "Legend teamfight mirror", ours: [8, 13, 129, 26, 5], theirs: [44, 11, 2, 30, 31], rankBracket: 5 },
  // Medusa, Storm Spirit, Tidehunter, Rubick, Dazzle vs Lycan, Leshrac, Underlord, Shadow Shaman, Chen.
  { name: "Divine late game against a push draft", ours: [94, 17, 29, 86, 50], theirs: [77, 52, 108, 27, 66], rankBracket: 7 },
  // Faceless Void, Invoker, Magnus, Earthshaker, Oracle vs Spectre, Ember Spirit, Bristleback, Nyx Assassin, Disruptor.
  { name: "Crusader teamfight against a late carry", ours: [41, 74, 97, 7, 111], theirs: [67, 106, 99, 88, 87], rankBracket: 3 },
  // Wraith King, Sniper, Axe, Ogre Magi, Lion vs Drow Ranger, Pudge, Legion Commander, Shadow Shaman, Crystal Maiden.
  { name: "Guardian pub draft", ours: [42, 35, 2, 84, 26], theirs: [6, 14, 104, 27, 5], rankBracket: 2 },
  // Terrorblade, Templar Assassin, Mars, Tusk, Disruptor vs Naga Siren, Pangolier, Primal Beast, Hoodwink, Treant Protector.
  { name: "Immortal illusion carries", ours: [109, 46, 129, 100, 87], theirs: [89, 120, 137, 123, 83], rankBracket: 8 },
  // Anti-Mage, Lina, Centaur Warrunner, Mirana, Warlock vs Troll Warlord, Huskar, Dark Seer, Snapfire, Jakiro.
  { name: "Archon farm carry against early fights", ours: [1, 25, 96, 9, 37], theirs: [95, 59, 55, 128, 64], rankBracket: 4 },
  // Can's draft (2026-11-02), whose story was "so bad": no natural carry, Vengeful Spirit can flex there.
  // Ursa, Ember Spirit, Mars, Shadow Shaman, Silencer vs Vengeful Spirit, Witch Doctor, Tidehunter, Pudge, Storm Spirit.
  { name: "Ancient against a lineup with no carry", ours: [70, 106, 129, 27, 75], theirs: [20, 30, 29, 14, 17], rankBracket: 6 },
];
