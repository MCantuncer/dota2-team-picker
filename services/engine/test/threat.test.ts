import { describe, expect, it } from "vitest";
import { answerDrop, findThreatPlans, lengthStep, MIN_STEP_GAMES, splitOf, type ThreatGame } from "../src/engine/threat";
import { dayQuery, fetchThreatPlans, MIN_THREAT_GAMES, positionOneHeroes, THREAT_DAYS, threatPlansDue, toThreatGames } from "../src/data/threat-plans";
import { fixture } from "./fixture";

/** A small seeded random number generator, so the games are the same on every run. */
function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Five different heroes from 2 to 20, never `skip`. */
function team(rand: () => number, skip: readonly number[]): number[] {
  const out: number[] = [];
  while (out.length < 5) {
    const h = 2 + Math.floor(rand() * 19);
    if (!out.includes(h) && !skip.includes(h)) out.push(h);
  }
  return out;
}

/**
 * Games where hero 1 plays on Radiant in every other game. With `answers` on the other team he wins less:
 * 60% with none, 15 points less for each answer. Other games are coin flips.
 */
function games(count: number, answers: readonly number[], seed = 7): ThreatGame[] {
  const rand = random(seed);
  const out: ThreatGame[] = [];
  for (let id = 0; id < count; id++) {
    if (id % 2 === 0) {
      const radiant = [1, ...team(rand, [1]).slice(0, 4)];
      const dire = team(rand, radiant);
      const p = 0.6 - 0.15 * dire.filter((h) => answers.includes(h)).length;
      out.push({ id, radiant, dire, radiantWin: rand() < p, minutes: 20 + rand() * 40 });
    } else {
      const radiant = team(rand, [1]);
      out.push({ id, radiant, dire: team(rand, [1, ...radiant]), radiantWin: rand() < 0.5, minutes: 20 + rand() * 40 });
    }
  }
  return out;
}

describe("findThreatPlans", () => {
  it("finds a hero who wins without his answers and loses with them, and his answers", () => {
    const { plans } = findThreatPlans(games(60_000, [10, 11]), new Set());
    const plan = plans.find((p) => p.hero === 1);
    expect(plan).toBeDefined();
    expect(plan!.answers.slice(0, 2).map((a) => a.hero).sort()).toEqual([10, 11]);
    expect(plan!.answers[0]!.gap).toBeLessThan(-3);
    expect(plan!.dropLow).toBeGreaterThanOrEqual(4);
    const [none, one, two] = plan!.stair;
    expect(none.winRate).toBeGreaterThan(one.winRate);
    expect(one.winRate).toBeGreaterThan(two.winRate);
    expect(plan!.length).toHaveLength(5);
  });

  it("finds no plan when no enemy changes his games", () => {
    expect(findThreatPlans(games(60_000, []), new Set()).plans).toEqual([]);
  });

  it("pools the game length line of the given heroes", () => {
    const { groupLength } = findThreatPlans(games(6_000, []), new Set([1]));
    expect(groupLength.reduce((n, s) => n + s.games, 0)).toBe(3_000);
  });
});

describe("threat helpers", () => {
  it("splits games three ways by match id", () => {
    expect([30, 31, 32].map(splitOf)).toEqual([0, 1, 2]);
  });

  it("puts a game in its length step", () => {
    expect([18, 30, 34.9, 44, 70].map(lengthStep)).toEqual([0, 1, 1, 3, 4]);
  });

  it("judges no drop while a step has too few games", () => {
    const few = MIN_STEP_GAMES - 1;
    expect(answerDrop([[few, few, few / 2, few / 4], [1000, 500, 500, 250], [1000, 400, 500, 250]])).toBeUndefined();
  });
});

describe("threat plans data", () => {
  it("is due when missing or a week old", () => {
    const data = fixture();
    const now = new Date("2026-11-12T00:00:00Z");
    expect(threatPlansDue(data, now)).toBe(true);
    data.threatPlans = { at: "2026-11-08T00:00:00Z", games: 1, plans: [], pos1Length: [] };
    expect(threatPlansDue(data, now)).toBe(false);
    data.threatPlans.at = "2026-11-05T00:00:00Z";
    expect(threatPlansDue(data, now)).toBe(true);
  });

  it("asks for ranked All Pick games of one day", () => {
    const sql = dayQuery(100, 200);
    expect(sql).toContain("lobby_type = 7 and game_mode = 22");
    expect(sql).toContain("start_time >= 100 and start_time < 200");
  });

  it("keeps only rows with every field", () => {
    const good = { match_id: 5, radiant_win: true, duration: 1800, radiant_team: [1, 2, 3, 4, 5], dire_team: [6, 7, 8, 9, 10] };
    const rows = [good, { ...good, radiant_team: [1, 2] }, { ...good, radiant_win: null }, null];
    expect(toThreatGames(rows)).toEqual([{ id: 5, radiantWin: true, minutes: 30, radiant: [1, 2, 3, 4, 5], dire: [6, 7, 8, 9, 10] }]);
    expect(() => toThreatGames(undefined)).toThrow();
  });

  it("counts a hero as position 1 when most of his games are there", () => {
    expect(positionOneHeroes({ 1: [80, 10, 5, 5, 0], 2: [50, 50, 0, 0, 0], 3: [0, 0, 0, 0, 0] })).toEqual(new Set([1]));
  });

  it("keeps the last plans when the explorer returns too few games or an error", async () => {
    const data = fixture();
    const now = new Date("2026-11-12T00:00:00Z");
    const few = async <T,>() => ({ rows: [] }) as T;
    await expect(fetchThreatPlans(data, few, now, 0)).rejects.toThrow(String(MIN_THREAT_GAMES));
    const failing = async <T,>() => ({ err: "timeout" }) as T;
    await expect(fetchThreatPlans(data, failing, now, 0)).rejects.toThrow("timeout");
    expect(data.threatPlans).toBeUndefined();
  });

  it("never reads games from before the patch", async () => {
    const asked: string[] = [];
    const now = new Date("2026-11-12T00:00:00Z");
    const patchStart = now.getTime() / 1000 - 2.5 * 24 * 60 * 60;
    const get = async <T,>(path: string) => {
      asked.push(decodeURIComponent(path));
      return { rows: [] } as T;
    };
    await expect(fetchThreatPlans(fixture(), get, now, patchStart)).rejects.toThrow();
    expect(asked.length).toBeLessThan(THREAT_DAYS);
    expect(asked).toHaveLength(3);
    expect(asked.at(-1)).toContain(`start_time >= ${Math.floor(patchStart)}`);
  });
});
