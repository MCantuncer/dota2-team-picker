/** A Sven-like hero and its common builds, for the skill build tests. */
import type { SliceTotals } from "../src/data/skill-build-choice";
import type { GuidePlayer } from "../src/data/skill-sequence";
import type { HeroAbilities } from "../src/engine/types";

// A Sven-like hero: Storm Hammer (Q), Great Cleave (W), Warcry (E), God's Strength (R).
export const Q = 1;
export const W = 2;
export const E = 3;
export const R = 4;
export const SVEN: HeroAbilities = {
  abilities: [
    {
      id: Q,
      key: "sven_storm_bolt",
      name: "Storm Hammer",
      slot: 1,
      maxLevel: 4,
      ultimate: false,
    },
    {
      id: W,
      key: "sven_great_cleave",
      name: "Great Cleave",
      slot: 2,
      maxLevel: 4,
      ultimate: false,
    },
    {
      id: E,
      key: "sven_warcry",
      name: "Warcry",
      slot: 3,
      maxLevel: 4,
      ultimate: false,
    },
    {
      id: R,
      key: "sven_gods_strength",
      name: "God's Strength",
      slot: 6,
      maxLevel: 3,
      ultimate: true,
    },
  ],
  talents: [
    [
      { id: 10, name: "+2 Mana Regen" },
      { id: 11, name: "+15 Damage" },
    ],
    [
      { id: 12, name: "+20% Cleave" },
      { id: 13, name: "+8 Strength" },
    ],
    [
      { id: 14, name: "+1.5s Storm Hammer" },
      { id: 15, name: "+25 Movement Speed" },
    ],
    [
      { id: 16, name: "+30% Cleave" },
      { id: 17, name: "+15% Warcry Armor" },
    ],
  ],
};

/** Q E W W W R W Q Q Q T R E E E T R: the common Sven pos 1 build to 18 (no point at 17). */
export const SVEN_BUILD = [Q, E, W, W, W, R, W, Q, Q, Q, 11, R, E, E, E, 13, 0, R];
/** The same with Warcry maxed before Storm Hammer. */
export const WARCRY_SECOND = [Q, E, W, W, W, R, W, E, E, E, 11, R, Q, Q, Q, 13, 0, R];

/** Skill points in order, from a build by level (0 is a level with no point). */
export const points = (levels: number[]): number[] => levels.filter((id) => id !== 0);
export const player = (levels: number[], extra: Partial<GuidePlayer> = {}): GuidePlayer => ({
  gameVersionId: 200,
  position: 1,
  level: levels.length,
  won: true,
  points: points(levels),
  ...extra,
});

/** STRATZ totals that agree with SVEN_BUILD: Cleave maxed at 7, Hammer at 10, Warcry at 15; first points 1, 3, 2. */
export const TOTALS: SliceTotals = {
  maxLevels: [
    { abilityId: W, level: 7, matchCount: 90000 },
    { abilityId: Q, level: 10, matchCount: 59000 },
    { abilityId: Q, level: 15, matchCount: 38000 },
    { abilityId: E, level: 15, matchCount: 90000 },
    { abilityId: E, level: 10, matchCount: 23000 },
    { abilityId: 999, level: 25, matchCount: 93 },
  ],
  firstLevels: [
    { abilityId: Q, level: 1, matchCount: 80000 },
    { abilityId: E, level: 2, matchCount: 70000 },
    { abilityId: W, level: 3, matchCount: 75000 },
    { abilityId: 0, level: 1, matchCount: 45000 },
  ],
  talents: [
    { abilityId: 10, matchCount: 16000 },
    { abilityId: 11, matchCount: 78000 },
    { abilityId: 12, matchCount: 30000 },
    { abilityId: 13, matchCount: 86000 },
  ],
};
