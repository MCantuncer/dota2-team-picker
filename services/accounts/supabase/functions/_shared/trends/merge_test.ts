import { assertEquals } from "jsr:@std/assert@1";
import { readHeroBenchmarks } from "./benchmarks.ts";
import { readRecentMatch } from "./games.ts";
import { mergeGames, type OpenDotaGame } from "./merge.ts";

const T = 1_762_000_000;
const benchmarks = readHeroBenchmarks({
  result: {
    gold_per_min: [{ percentile: 0.5, value: 500 }, { percentile: 0.9, value: 700 }],
    xp_per_min: [{ percentile: 0.5, value: 600 }, { percentile: 0.9, value: 800 }],
  },
});

const openDota = (matchId: number, over: Record<string, unknown> = {}): OpenDotaGame => {
  const match = readRecentMatch({
    match_id: matchId,
    player_slot: 0,
    radiant_win: true,
    hero_id: 114,
    start_time: T + matchId,
    duration: 2400,
    lane_role: 1,
    last_hits: 300,
    gold_per_min: 720,
    xp_per_min: 820,
    ...over,
  });
  if (!match) throw new Error("bad fixture");
  return { match, benchmarks };
};

Deno.test("OpenDota alone: lane position and benchmark strength", () => {
  const [game] = mergeGames([], [], [openDota(1)]);
  assertEquals(game?.position, 1);
  assertEquals(game?.positionSource, "opendota");
  assertEquals(game?.isStrong, true);
});

Deno.test("STRATZ position and IMP win over OpenDota", () => {
  const stratz = [{ matchId: 1, heroId: 114, startTime: T + 1, isWin: true, position: 3 as const, imp: 5 }];
  const [game] = mergeGames([], stratz, [openDota(1)]);
  assertEquals(game?.position, 3);
  assertEquals(game?.positionSource, "stratz");
  assertEquals(game?.isStrong, false, "IMP 5 is under the bar even though the GPM was high");
});

Deno.test("an unparsed OpenDota game is judged at the STRATZ position", () => {
  const stratz = [{ matchId: 1, heroId: 114, startTime: T + 1, isWin: true, position: 1 as const, imp: null }];
  const [game] = mergeGames([], stratz, [openDota(1, { lane_role: null })]);
  assertEquals(game?.position, 1);
  assertEquals(game?.isStrong, true);
});

Deno.test("the draft position is used only when no match data tells the position", () => {
  const draft = [{ matchId: 1, heroId: 114, startTime: T + 1, isWin: true, position: 5 as const }];
  assertEquals(mergeGames(draft, [], [openDota(1)])[0]?.position, 1, "lanes say carry");
  const unparsed = mergeGames(draft, [], [openDota(1, { lane_role: null })])[0];
  assertEquals(unparsed?.position, 5);
  assertEquals(unparsed?.positionSource, "draft");
  assertEquals(mergeGames(draft, [], [])[0]?.isStrong, null, "a draft alone can't tell strength");
});

Deno.test("a draft naming another hero for the match is ignored", () => {
  const draft = [{ matchId: 1, heroId: 7, startTime: T + 1, isWin: true, position: 5 as const }];
  const [game] = mergeGames(draft, [], [openDota(1, { lane_role: null })]);
  assertEquals(game?.heroId, 114);
  assertEquals(game?.position, null);
});

Deno.test("games come newest first, one per match", () => {
  const games = mergeGames([], [], [openDota(1), openDota(3), openDota(2)]);
  assertEquals(games.map((g) => g.matchId), [3, 2, 1]);
});
