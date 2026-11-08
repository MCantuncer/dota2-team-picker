import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planTeam, type PlanSlot } from "../src/engine/plan";
import { Engine } from "../src/engine/score";
import { POSITIONS, type Position, type Snapshot } from "../src/engine/types";

/**
 * The pool rule for Team Plan on many random drafts with real hero data: a player with a pool is
 * planned from it, and gets a hero from outside it only when every one of their pool heroes is
 * picked, banned or planned for someone else. On live data before this rule, 1 in 7 planned heroes
 * was outside a player's 5-hero pool (2026-11-08).
 */

const snapshot = JSON.parse(readFileSync(new URL("./fixtures/golden-snapshot.json", import.meta.url), "utf8")) as Snapshot;
const engine = new Engine(snapshot);

/** A small seeded random generator, so a failure always comes back the same. */
let seed = 20261108;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const shuffle = <T>(xs: T[]) => xs.map((x) => ({ x, k: rnd() })).sort((a, b) => a.k - b.k).map(({ x }) => x);

const ids = engine.heroes.map((h) => h.id);
/** A pool of 1 to 5 heroes that play the position, sometimes shared with a teammate's pool. */
const poolFor = (position: Position, shared: number[]) => {
  const own = shuffle(ids.filter((id) => engine.fit(id)[position] >= 0.2)).slice(0, 1 + Math.floor(rnd() * 5));
  return rnd() < 0.3 ? [...new Set([...own, ...shared])] : own;
};

describe("Team Plan pool rule on random drafts", () => {
  it("plans each player from their pool, and from outside it only when the pool is used up", () => {
    let fallbacks = 0;
    for (let n = 0; n < 40; n++) {
      const heroes = shuffle(ids);
      const enemies = heroes.slice(0, Math.floor(rnd() * 5));
      const bans = heroes.slice(enemies.length, enemies.length + Math.floor(rnd() * 6));
      const positions = shuffle([...POSITIONS]);
      const lockedCount = Math.floor(rnd() * 3);
      let shared: number[] = [];
      const slots: PlanSlot[] = positions.map((position, i) => {
        if (i < lockedCount) return { position, playerId: `p${position}`, heroId: heroes[20 + i]! };
        if (rnd() < 0.2) return { position };
        const favorites = poolFor(position, shared);
        shared = favorites.slice(0, 1);
        return { position, playerId: `p${position}`, favorites };
      });
      const plan = planTeam(engine, { slots, enemies, bans });
      const planned = new Set(plan.slots.map((s) => s.heroId));
      for (const s of plan.slots) {
        const pool = slots.find((x) => x.position === s.position)!.favorites ?? [];
        if (s.locked || !pool.length) continue;
        for (const alt of s.alternatives) expect(pool).toContain(alt.heroId);
        if (s.inPool) {
          expect(pool).toContain(s.heroId);
          continue;
        }
        fallbacks++;
        // Outside the pool only when no pool hero is left for this slot.
        const left = pool.filter((id) => !enemies.includes(id) && !bans.includes(id) && !planned.has(id));
        expect(left).toEqual([]);
      }
    }
    // The shared pools make some fallbacks happen, so that path is tested too.
    expect(fallbacks).toBeGreaterThan(0);
  });
});
