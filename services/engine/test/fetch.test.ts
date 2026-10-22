import { describe, expect, it } from "vitest";
import { countMatch } from "../src/data/fetch";
import type { Snapshot } from "../src/engine/types";

const empty = (): Snapshot => ({ generatedAt: "", heroes: {}, bracketStats: {}, matchups: {}, synergy: {}, laneRoles: {} });

describe("countMatch", () => {
  it("adds matchups and synergy for a finished ranked game", () => {
    const data = empty();
    const counted = countMatch(data, {
      match_id: 1,
      radiant_win: true,
      duration: 2400,
      lobby_type: 7,
      game_mode: 22,
      radiant_team: [1, 2, 3, 4, 5],
      dire_team: [6, 7, 8, 9, 10],
    });
    expect(counted).toBe(true);
    expect(data.matchups[1]![6]).toEqual({ games: 1, wins: 1 });
    expect(data.matchups[6]![1]).toEqual({ games: 1, wins: 0 });
    expect(data.synergy["1-2"]).toEqual({ games: 1, wins: 1 });
    expect(data.synergy["6-7"]).toEqual({ games: 1, wins: 0 });
  });

  it("skips turbo and early abandons", () => {
    const data = empty();
    const base = { match_id: 1, radiant_win: true, lobby_type: 0, radiant_team: [1, 2, 3, 4, 5], dire_team: [6, 7, 8, 9, 10] };
    expect(countMatch(data, { ...base, duration: 2400, game_mode: 23 })).toBe(false);
    expect(countMatch(data, { ...base, duration: 300, game_mode: 22 })).toBe(false);
  });
});
