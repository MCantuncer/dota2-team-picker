import { describe, expect, it } from "vitest";
import { updateDataHardCounters } from "../src/data/fetch";
import { findHardCounters, holdHardCounters, MIN_GAMES, mergeHardCounters, PER_HERO } from "../src/engine/data-hard-counters";
import { Engine } from "../src/engine/score";
import type { Snapshot } from "../src/engine/types";
import { fixture } from "./fixture";

/** The fixture with Mid Three (3) losing 38% of 2000 games to Support Six (6). */
function withCounter(games = 2000, wins = 760): Snapshot {
  const data = fixture();
  data.matchups = { 3: { 6: { games, wins } }, 6: { 3: { games, wins: games - wins } } };
  return data;
}
const find = (data: Snapshot) => findHardCounters(new Engine(data, { hardCounters: [] }), data);

describe("findHardCounters", () => {
  it("finds a pair far below what the win rates predict, over enough games", () => {
    const [hc, ...rest] = find(withCounter());
    expect(rest).toEqual([]);
    expect(hc).toMatchObject({ hero: 3, counter: 6, names: "Mid Three < Support Six" });
    expect(hc!.gap).toBeGreaterThanOrEqual(5);
  });

  it("skips pairs with too few games or a small gap", () => {
    expect(find(withCounter(MIN_GAMES - 1, Math.round((MIN_GAMES - 1) * 0.38)))).toEqual([]);
    expect(find(withCounter(2000, 940))).toEqual([]);
  });

  it("keeps each hero's worst few", () => {
    const data = fixture();
    // Mid Three loses badly to four heroes and wins big against two, so its own win rate stays even.
    const rows: Record<number, { games: number; wins: number }> = {
      1: { games: 3000, wins: 900 },
      2: { games: 3000, wins: 930 },
      4: { games: 3000, wins: 960 },
      5: { games: 3000, wins: 990 },
      6: { games: 6000, wins: 4800 },
      7: { games: 6000, wins: 4800 },
    };
    data.matchups = { 3: {} };
    for (const [enemy, gw] of Object.entries(rows)) {
      data.matchups[3]![enemy] = gw;
      data.matchups[enemy] = { 3: { games: gw.games, wins: gw.games - gw.wins } };
    }
    const mine = find(data).filter((hc) => hc.hero === 3);
    expect(mine).toHaveLength(PER_HERO);
    expect(mine.map((hc) => hc.counter)).toEqual([1, 2, 4]);
  });
});

describe("holdHardCounters", () => {
  const hc = { hero: 3, counter: 6, gap: 6, names: "Mid Three < Support Six" };

  it("adds a pair only after two runs in a row, and drops its streak when it falls out", () => {
    const first = holdHardCounters([hc]);
    expect(first.list).toEqual([]);
    const second = holdHardCounters([hc], first.streaks);
    expect(second.list).toEqual([hc]);
    const gone = holdHardCounters([], second.streaks);
    expect(gone.list).toEqual([]);
    expect(gone.streaks).toEqual({});
  });
});

describe("mergeHardCounters", () => {
  it("keeps the hand list as is and adds only new pairs", () => {
    const hand = [{ hero: 3, counter: 6, gap: 8, names: "hand" }];
    const data = [
      { hero: 3, counter: 6, gap: 5.5, names: "data" },
      { hero: 2, counter: 5, gap: 6, names: "data 2" },
    ];
    expect(mergeHardCounters(hand, data).map((hc) => hc.names)).toEqual(["hand", "data 2"]);
    expect(mergeHardCounters(hand)).toEqual(hand);
  });
});

describe("in the engine and the refresh", () => {
  it("the refresh saves held pairs and the engine names them on the card", () => {
    const data = withCounter();
    updateDataHardCounters(data);
    expect(data.dataHardCounters).toEqual([]);
    updateDataHardCounters(data);
    expect(data.dataHardCounters).toHaveLength(1);
    const card = new Engine(data).suggest({ myPosition: 2, allies: [], enemies: [6], count: 100 }).find((s) => s.heroId === 3)!;
    expect(card.hardCounters.map((n) => n.text)).toEqual(["Hard countered: Support Six is on the enemy team"]);
  });
});
