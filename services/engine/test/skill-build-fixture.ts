/** A Sven-like hero and its common builds, for the skill build tests. */
import type { SlicePatch, SliceTotals } from "../src/data/skill-build-choice";
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

/**
 * The common Sven pos 1 build's skill points in order: Q E W W W R W Q Q Q, the level 10 talent beside the last Q, then
 * E R E E, the level 15 talent and R. A talent doesn't use the level's point.
 */
export const SVEN_POINTS = [Q, E, W, W, W, R, W, Q, Q, Q, 11, E, R, E, E, 13, R];
/** Its ability at each level to 18: God's Strength at 6, 12 and 18, and nothing left to take at 15 to 17. */
export const SVEN_BUILD = [Q, E, W, W, W, R, W, Q, Q, Q, E, R, E, E, 0, 0, 0, R];
/** The same with Warcry maxed before Storm Hammer. */
export const WARCRY_SECOND_POINTS = [Q, E, W, W, W, R, W, E, E, E, 11, Q, R, Q, Q, 13, R];
export const WARCRY_SECOND = [Q, E, W, W, W, R, W, E, E, E, Q, R, Q, Q, 0, 0, 0, R];

/** The patch the slices are built for: saved under version 200, started at Unix second 1000. */
export const PATCH: SlicePatch = { versionId: 200, start: 1000 };

/** A guide player who ended at level 18 with these skill points, in a game of PATCH. */
export const player = (points: number[], extra: Partial<GuidePlayer> = {}): GuidePlayer => ({
  start: 2000,
  position: 1,
  level: 18,
  won: true,
  points,
  ...extra,
});

/** STRATZ totals that agree with SVEN_BUILD: Cleave maxed at 7, Hammer at 10, Warcry at 14; first points 1, 3, 2. */
export const TOTALS: SliceTotals = {
  maxLevels: [
    { abilityId: W, level: 7, matchCount: 90000 },
    { abilityId: Q, level: 10, matchCount: 59000 },
    { abilityId: Q, level: 14, matchCount: 38000 },
    { abilityId: E, level: 14, matchCount: 90000 },
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
