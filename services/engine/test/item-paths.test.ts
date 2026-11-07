import { describe, expect, it } from "vitest";
import { bigItemCheck, seeded } from "../src/engine/item-odds";
import { candidateKeys, itemPaths, keyPaths, latePath, MIN_GROUP, type PathGame } from "../src/engine/item-paths";
import type { ItemInfo } from "../src/engine/types";

const item = (key: string, cost: number, components: number[] = []): ItemInfo => ({ key, name: key, cost, img: "", components });
// 1 Radiance, 2 Armlet, 3 Blink, 4 BKB, 5 Assault Cuirass, 6 Phase Boots, 7 Relic (part of Radiance), 8 Desolator.
const ITEMS: Record<string, ItemInfo> = {
  "1": item("radiance", 4700, [7]),
  "2": item("armlet", 2500),
  "3": item("blink", 2250),
  "4": item("black_king_bar", 4050),
  "5": item("assault", 5125),
  "6": item("phase_boots", 1500),
  "7": item("relic", 3750),
  "8": item("desolator", 3500),
};
const isBig = bigItemCheck(ITEMS);
const m = (minute: number) => minute * 60;
const game = (items: [number, number][], minutes = 40): PathGame => ({
  duration: m(minutes),
  items: items.map(([id, minute]) => [id, m(minute)]),
});
const times = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

describe("candidateKeys", () => {
  it("takes Blink and the first two costly items by minute, not boots or parts", () => {
    const slice = {
      games: 500,
      items: [
        [6, 8, 10],
        [7, 12, 15],
        [1, 16, 18],
        [8, 23, 29],
        [3, 20, 21],
        [4, 31, 36],
      ] as [number, number, number][],
    };
    expect(candidateKeys(slice, ITEMS, isBig)).toEqual([
      { id: 3, late: 21 },
      { id: 1, late: 18 },
      { id: 8, late: 29 },
    ]);
  });
});

describe("latePath", () => {
  it("takes the most common next item at each step, with its median minute", () => {
    const games = [
      ...times(6, () => game([[2, 17], [3, 21], [4, 25]])),
      ...times(4, () => game([[3, 19], [2, 22], [4, 26]])),
    ];
    // Armlet is next for 6 of 10. Then Blink is next for all 10: the Armlet games after Armlet, the
    // others from their start (their Armlet comes after, already on the path).
    expect(latePath(games, isBig)).toEqual([
      [2, 17, 6],
      [3, 21, 10],
      [4, 25, 10],
    ]);
  });
  it("takes each step's median minute and never goes back in time", () => {
    const games = [...times(5, () => game([[2, 20], [4, 30]])), ...times(5, () => game([[4, 15], [2, 25]]))];
    // Tie on 5 games: Armlet's median 20 against BKB's 15, so BKB first at 15, then Armlet (20 and 25: 22.5).
    expect(latePath(games, isBig)).toEqual([
      [4, 15, 5],
      [2, 23, 10],
    ]);
    const later = [...times(6, () => game([[2, 25], [4, 30]])), ...times(4, () => game([[4, 15], [2, 20]]))];
    // Armlet at 25 first (6 games), then BKB: the 6 at 30 and the 4 at 15 give a median of 30.
    expect(latePath(later, isBig)).toEqual([
      [2, 25, 6],
      [4, 30, 10],
    ]);
    // Mixed orders never give a step earlier than the one before it.
    const random = seeded(4);
    const ids = [1, 2, 3, 4, 5, 8];
    const mixed = times(40, () => {
      const order = [...ids].sort(() => random() - 0.5).slice(0, 4);
      let t = 10;
      return game(order.map((id) => [id, (t += 1 + Math.floor(random() * 8))]));
    });
    const minutes = latePath(mixed, isBig).map(([, minute]) => minute);
    expect(minutes).toEqual([...minutes].sort((x, y) => x - y));
  });
  it("stops when under 40% of the games buy the same item next", () => {
    const games = [
      ...times(5, () => game([[2, 17], [4, 25]])),
      ...times(3, () => game([[2, 17], [5, 30]])),
      ...times(2, () => game([[2, 17], [8, 28]])),
    ];
    // After Armlet: BKB 5 of 10 passes, then Assault 3 of 10 and Desolator 2 of 10 don't.
    expect(latePath(games, isBig)).toEqual([
      [2, 17, 10],
      [4, 25, 5],
    ]);
  });
  it("counts a part built up soon after as one item", () => {
    const games = times(10, () => game([[7, 20], [1, 24]]));
    expect(latePath(games, isBig)).toEqual([[1, 24, 10]]);
  });
});

describe("keyPaths", () => {
  const onTime = (n: number) => times(n, () => game([[6, 8], [1, 16], [4, 25]]));
  const late = (n: number) => times(n, () => game([[6, 8], [2, 17], [1, 28]]));
  it("splits the games still running at the late minute", () => {
    const short = times(5, () => game([[2, 17]], 15));
    const paths = keyPaths([...onTime(20), ...late(MIN_GROUP), ...short], 1, 18, isBig);
    expect(paths).toMatchObject({ late: 18, running: 20 + MIN_GROUP, onTime: 20 });
    expect(paths?.path?.games).toBe(MIN_GROUP);
    expect(paths?.path?.steps.map(([id]) => id)).toEqual([6, 2, 1]);
  });
  it("counts the key item on the late path with its own number, not the next-item count", () => {
    const never = times(4, () => game([[6, 8], [2, 17], [4, 30]]));
    const paths = keyPaths([...onTime(20), ...late(10), ...never], 1, 18, isBig);
    expect(paths?.path?.games).toBe(14);
    expect(paths?.path?.keyLater).toBe(10);
  });
  it("gives no path to a late group under the minimum, but keeps the counts", () => {
    const paths = keyPaths([...onTime(20), ...late(MIN_GROUP - 1)], 1, 18, isBig);
    expect(paths).toEqual({ late: 18, running: 20 + MIN_GROUP - 1, onTime: 20 });
  });
  it("skips a key item few games buy", () => {
    expect(keyPaths(times(20, () => game([[2, 17]])), 1, 18, isBig)).toBeUndefined();
  });
  it("gives a path where the key item never comes in the late group", () => {
    const never = times(MIN_GROUP, () => game([[6, 8], [2, 17], [4, 25]]));
    const paths = keyPaths([...onTime(20), ...never], 1, 18, isBig);
    expect(paths?.path?.keyLater).toBe(0);
    expect(paths?.path?.steps.map(([id]) => id)).toEqual([6, 2, 4]);
  });
});

describe("itemPaths", () => {
  it("is empty without timings, so the slice is still saved", () => {
    expect(itemPaths([], undefined, ITEMS, isBig)).toEqual({});
  });
  it("keeps only keys that pass, keyed by item id", () => {
    const slice = { games: 500, items: [[1, 16, 18], [4, 31, 36]] as [number, number, number][] };
    const games = [...times(20, () => game([[1, 16], [4, 25]])), ...times(MIN_GROUP, () => game([[2, 17], [1, 28]]))];
    const paths = itemPaths(games, slice, ITEMS, isBig);
    expect(Object.keys(paths)).toEqual(["1", "4"]);
    expect(paths["1"]?.path?.steps[0]).toEqual([2, 17, MIN_GROUP]);
  });
});
