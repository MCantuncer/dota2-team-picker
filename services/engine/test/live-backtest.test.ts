import { describe, expect, it } from "vitest";
import { addDraftScores, draftScoreLine, emptyDraftScore, scoreDrafts } from "../src/backtest/draft-score";
import { copyDays, dailySource, scoreByCopy } from "../src/backtest/live";
import type { EvalMatch } from "../src/data/eval-matches";
import { Engine } from "../src/engine/score";
import type { Position } from "../src/engine/types";
import { fixture } from "./fixture";

const at = (iso: string) => Date.parse(iso) / 1000;

/** A finished game: Radiant takes `radiant`, Dire `dire`, picks alternating. */
function game(id: number, startIso: string, radiant: number[], dire: number[], radiantWin: boolean): EvalMatch {
  const picks = radiant.flatMap((r, i) => [
    { heroId: r, radiant: true, position: ((i % 5) + 1) as Position },
    { heroId: dire[i]!, radiant: false, position: ((i % 5) + 1) as Position },
  ]);
  return { id, startTime: at(startIso), rankTier: 54, radiantWin, picks, bans: [] };
}

describe("live backtest copies", () => {
  it("names the daily copy as the upload saves it", () => {
    expect(dailySource("2026-11-07")).toBe("daily/2026-11-07.json");
  });

  it("needs the copies from the day before the first game to the day of the last", () => {
    const games = [game(1, "2026-11-03T22:00:00Z", [], [], true), game(2, "2026-11-01T01:00:00Z", [], [], true)];
    expect(copyDays(games)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(copyDays([])).toEqual([]);
  });

  it("scores each game with the newest copy built before it started", async () => {
    const built = { "nov-1": at("2026-11-01T21:00:00Z"), "nov-2": at("2026-11-02T21:00:00Z"), "nov-3": at("2026-11-03T21:00:00Z") };
    const early = game(1, "2026-11-01T10:00:00Z", [], [], true); // Before every copy: left out.
    const morning = game(2, "2026-11-02T08:00:00Z", [], [], true); // The day's copy isn't built yet.
    const night = game(3, "2026-11-02T22:00:00Z", [], [], true);
    const exact = game(4, "2026-11-03T21:00:00Z", [], [], true); // Same second as nov-3: that copy wasn't before it.
    const late = game(5, "2026-11-05T12:00:00Z", [], [], true);
    const loaded: string[] = [];
    const scored: [string, number[]][] = [];
    await scoreByCopy(
      [late, night, early, exact, morning],
      ["nov-1", "missing", "nov-2", "nov-3"],
      async (day) => {
        loaded.push(day);
        return day in built ? { copy: day, builtAt: built[day as keyof typeof built] } : null;
      },
      (copy, games) => scored.push([copy, games.map((g) => g.id)]),
    );
    expect(loaded).toEqual(["nov-1", "missing", "nov-2", "nov-3"]);
    expect(scored).toEqual([
      ["nov-1", [2]],
      ["nov-2", [3, 4]],
      ["nov-3", [5]],
    ]);
  });

  it("skips a copy built before the one it follows", async () => {
    const scored: [string, number[]][] = [];
    await scoreByCopy(
      [game(1, "2026-11-02T22:00:00Z", [], [], true)],
      ["a", "b"],
      async (day) => ({ copy: day, builtAt: day === "a" ? at("2026-11-02T21:00:00Z") : at("2026-11-02T20:00:00Z") }),
      (copy, games) => scored.push([copy, games.map((g) => g.id)]),
    );
    expect(scored).toEqual([["a", [1]]]);
  });
});

describe("draft winner", () => {
  const engine = new Engine(fixture());
  // In the fixture Mid Three beats Offlane Five clearly, and everything else is even.
  const three = game(1, "2026-11-01T00:00:00Z", [3, 1, 4, 6, 7], [5, 1, 4, 6, 7], true);

  it("counts the favored side's wins, and skips games with no favorite or missing picks", () => {
    const lost = { ...three, id: 2, radiantWin: false };
    const even = game(3, "2026-11-01T00:00:00Z", [1, 2, 4, 6, 7], [1, 2, 4, 6, 7], true);
    const short = { ...three, id: 4, picks: three.picks.slice(0, 8) };
    expect(scoreDrafts(engine, [three, lost, even, short])).toMatchObject({ games: 2, correct: 1, modelGames: 0 });
  });

  it("adds up scores from different hero data", () => {
    const one = scoreDrafts(engine, [three]);
    expect(addDraftScores(one, one)).toMatchObject({ games: 2, correct: 2 });
    expect(addDraftScores(emptyDraftScore(), one)).toEqual(one);
  });

  it("scores the win model's log loss when there is one", () => {
    const withModel = new Engine({ ...fixture(), winModel: { fittedAt: "2026-10-31T00:00:00Z", games: 500, byKnown: { 10: { a: 0, b: 0.2 } } } });
    const s = scoreDrafts(withModel, [three]);
    expect(s.modelGames).toBe(1);
    expect(s.lossGain).toBeLessThan(0); // Favored the winner, so better than a coin flip.
    expect(draftScoreLine(s)).toMatch(/Win model log loss 0\.\d{4} ± 0\.0000 on 1 games/);
  });

  it("writes the accuracy with its margin", () => {
    expect(draftScoreLine({ games: 100, correct: 60, modelGames: 0, lossGain: 0, lossGainSq: 0 })).toBe(
      "Draft winner on 100 games: the side the engine favors won 60.0% ± 9.6% (50% is a coin flip).",
    );
    expect(draftScoreLine(emptyDraftScore())).toBe("Draft winner: no games with all ten picks.");
  });
});
