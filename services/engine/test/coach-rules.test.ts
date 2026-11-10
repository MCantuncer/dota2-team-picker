import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gamePlan } from "../src/engine/game-plan";
import { STARTING_GOLD, coreTimingItems, sharesBuiltPart } from "../src/engine/item-build";
import { MIN_SLICE_GAMES } from "../src/engine/item-timing-slice";
import { Engine } from "../src/engine/score";
import { rankGroup, type Position, type RankBracket, type Snapshot } from "../src/engine/types";

/**
 * Can's item cases (2026-11-09) stated as rules, never as one hero's item, and checked for every hero
 * and position in the golden snapshot (real data, scripts/golden-fixture.ts) at every rank group:
 * - Necrophos mid started with 760 gold of items: a start fits in the starting gold.
 * - Carry Vengeful Spirit lost Aghanim's Scepter: the items a position buys most are in its build.
 * - Slark lost Diffusal Blade (his most bought item, minute 14) because Disperser, bought at 38, is built
 *   from it, and neither was shown: the most bought item, or an item built from it, is shown.
 * Razor's case (Sange and Yasha at 17, Mjollnir at 18) needs how much gold players have by each minute,
 * which the snapshot does not hold yet; its rule comes with that data (item engine plan, step 3).
 */
// The fixture is a snapshot written by scripts/golden-fixture.ts.
const snapshot = JSON.parse(readFileSync(new URL("./fixtures/golden-snapshot.json", import.meta.url), "utf8")) as Snapshot;
const engine = new Engine(snapshot);
// The golden fixture always holds the item list.
const items = snapshot.items!;
const cost = (id: number) => items[id]?.cost ?? 0;

/** Whether `item` is built from `part`, all the way down (Dagon 3 from Dagon through Dagon 2). */
const builtFrom = (item: number, part: number): boolean =>
  (items[item]?.components ?? []).some((c) => c === part || builtFrom(c, part));

/** Two real enemy lineups from the golden drafts; a hero in the first plays against the second. */
const ENEMY_LINEUPS = [
  [44, 11, 2, 30, 31],
  [77, 52, 108, 27, 66],
];
/** One bracket in each rank group. */
const RANKS: RankBracket[] = [2, 4, 6, 8];
const POSITIONS: Position[] = [1, 2, 3, 4, 5];
const heroIds = Object.keys(snapshot.itemTimings ?? {}).map(Number);

const cases = heroIds.flatMap((heroId) => {
  // The two lineups share no hero, so one of them never holds this hero.
  const theirs = ENEMY_LINEUPS.find((l) => !l.includes(heroId))!;
  const mates = heroIds.filter((id) => id !== heroId && !theirs.includes(id));
  return POSITIONS.flatMap((position) =>
    RANKS.map((rankBracket) => {
      // The fixture has far more than four other heroes.
      const ours = POSITIONS.map((p, i) => ({ heroId: p === position ? heroId : mates[i]!, position: p }));
      // A game plan has one player per position.
      const player = gamePlan(engine, { ours, theirs, rankBracket }).players[position - 1]!;
      return { label: `${engine.hero(heroId).name} pos ${position}, rank ${rankBracket}`, heroId, position, rankBracket, build: player.build };
    }),
  );
});

describe("coach rules", () => {
  it("check enough heroes and positions to mean something", () => {
    expect(cases.filter((c) => c.build).length).toBeGreaterThan(800);
  });

  it("start every player with items that fit in the starting gold (Necrophos mid)", () => {
    for (const { label, build } of cases) {
      const spent = (build?.start ?? []).reduce((sum, i) => sum + cost(i.itemId) * (i.count ?? 1), 0);
      expect(spent, label).toBeLessThanOrEqual(STARTING_GOLD);
    }
  });

  // When the build comes from one of these slices its top items are there by construction; the rule
  // bites when a build drops this position's own list for OpenDota's rough one, which mixes positions
  // (it fails with THIN_SLICE_MIN_ITEMS back at 4), or when filtering loses one.
  it("show the three items a position buys most, in its rank group or in every rank (carry Vengeful Spirit)", () => {
    for (const { label, heroId, position, rankBracket, build } of cases) {
      const slices = snapshot.itemTimings?.[heroId]?.[position];
      const usual = [slices?.[`${rankGroup(rankBracket)}`], slices?.all].flatMap((s) => (s && s.games >= MIN_SLICE_GAMES ? [s] : []));
      if (!build || !usual.length) continue;
      const shown = [...build.core, ...(build.bootsOr ? [build.bootsOr] : [])].map((i) => i.itemId);
      // The item itself, an item built from it (Dragon Lance in Hurricane Pike), or a choice built from the
      // same part (Sange and Yasha for Manta Style).
      const isShown = (id: number) =>
        shown.includes(id) || shown.some((other) => items[other]?.components.includes(id) || sharesBuiltPart(other, id, items));
      const missing = usual.map((slice) => coreTimingItems(slice, items, 3).filter(([id]) => !isShown(id)).map(([id]) => items[id]?.name));
      expect(missing.some((m) => m.length === 0), `${label}: ${missing.flat().join(", ")} missing from ${build.core.map((i) => i.name).join(", ")}`).toBe(true);
    }
  });

  it("show the item a position buys most, or an item built from it (Slark's Diffusal Blade)", () => {
    for (const { label, heroId, position, rankBracket, build } of cases) {
      const slices = snapshot.itemTimings?.[heroId]?.[position];
      const usual = [slices?.[`${rankGroup(rankBracket)}`], slices?.all].flatMap((s) => (s && s.games >= MIN_SLICE_GAMES ? [s] : []));
      if (!build || !usual.length) continue;
      const shown = [...build.core, ...(build.bootsOr ? [build.bootsOr] : [])];
      // In the rank group or in every rank, like the rule above.
      const missing = usual.flatMap((slice) => {
        const top = slice.items[0];
        if (!top) return [];
        const [id] = top;
        // The item, an item built from it (Dagon 1 into Dagon 3), or a choice built from the same part.
        const ok = shown.some((o) => o.itemId === id || builtFrom(o.itemId, id) || sharesBuiltPart(o.itemId, id, items));
        return ok ? [] : [items[id]?.name];
      });
      expect(missing.length < usual.length, `${label}: ${missing.join(", ")} missing from ${build.core.map((i) => i.name).join(", ")}`).toBe(true);
    }
  });
});
