import type { HeroInfo, Snapshot } from "../src/engine/types";

/** A tiny hand-made snapshot: two mids, a carry, an offlaner and two supports. */
export function fixture(): Snapshot {
  const hero = (id: number, name: string, roles: string[]): HeroInfo => ({
    id,
    name,
    roles,
    attackType: "Ranged",
    primaryAttr: "int",
  });
  const heroes = [
    hero(1, "Carry One", ["Carry", "Escape"]),
    hero(2, "Mid Two", ["Nuker"]),
    hero(3, "Mid Three", ["Nuker", "Disabler"]),
    hero(4, "Support Four", ["Support", "Disabler"]),
    hero(5, "Offlane Five", ["Initiator", "Durable", "Disabler"]),
    hero(6, "Support Six", ["Support", "Nuker"]),
  ];
  const even = { picks: Array(8).fill(1000), wins: Array(8).fill(500) };
  return {
    generatedAt: "2026-10-22T00:00:00Z",
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    bracketStats: Object.fromEntries(heroes.map((h) => [h.id, even])),
    matchups: {
      // Mid Three beats Offlane Five clearly.
      3: { 5: { games: 1000, wins: 600 } },
      5: { 3: { games: 1000, wins: 400 } },
    },
    synergy: {},
    laneRoles: {
      1: { "1": 100 },
      2: { "2": 100 },
      3: { "2": 100 },
      4: { "1": 50, "3": 50 },
      5: { "3": 100 },
      6: { "1": 100 },
    },
  };
}
