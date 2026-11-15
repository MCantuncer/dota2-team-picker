import { assertEquals } from "jsr:@std/assert@1";
import { type Match, readOpenDotaMatch } from "../report/match.ts";
import { FIGHT_GAP_S, fightLabel, scoreDeaths, tookRuneBefore, wardsUpAt } from "./fights.ts";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const ursaGame = () => readOpenDotaMatch(fixture("ursa-9073776545.json"));
const svenGame = () => readOpenDotaMatch(fixture("sven-9073477575.json"));
const player = (match: Match, accountId: number) => {
  const p = match.players.find((x) => x.accountId === accountId);
  if (!p) throw new Error(`no player ${accountId}`);
  return p;
};

Deno.test("labels a fight by how many heroes each side lost", () => {
  assertEquals(
    [[1, 0], [2, 0], [5, 2], [2, 2], [2, 3], [1, 3], [2, 4]].map(([ours, theirs]) => fightLabel(ours!, theirs!)),
    ["caught_alone", "lost_fight", "lost_fight", "even_trade", "close_win", "good_trade", "good_trade"],
  );
});

Deno.test("scores the Sven game's deaths the way the plan reads them", () => {
  const match = svenGame();
  const scores = scoreDeaths(match, player(match, 1005)) ?? [];
  assertEquals(
    scores.map((s) => [s.startS, s.ourDeaths, s.theirDeaths]),
    [
      [847, 1, 0], // 14:07 Nyx Assassin, caught alone
      [1062, 5, 2], // 18:04, lost 5 for 2 (the fight started at 17:42)
      [1189, 2, 0], // 19:49, lost 2 for 0
      [1321, 1, 0], // 22:01 Legion Commander, caught alone
      [2405, 2, 3], // 40:05, close win
      [2550, 1, 3], // 42:35, good trade
      [2699, 2, 4], // 45:09, good trade
    ],
  );
});

Deno.test("scores the Ursa game, including first blood before the horn", () => {
  const match = ursaGame();
  const scores = scoreDeaths(match, player(match, 1000)) ?? [];
  assertEquals(
    scores.map((s) => [s.startS, s.ourDeaths, s.theirDeaths, s.label]),
    [
      [-46, 1, 0, "caught_alone"],
      [272, 2, 0, "lost_fight"],
      [1435, 3, 1, "lost_fight"],
      [2259, 4, 0, "lost_fight"], // 37:39 Rubick, lost 4 for 0
    ],
  );
});

Deno.test(`deaths ${FIGHT_GAP_S} seconds apart join one fight, a second more splits it`, () => {
  const match = svenGame();
  const at = (times: number[]) => times.map((time) => ({ time, goldLost: 0, timeDead: 10, goldFed: 0, killer: null }));
  const [me, enemy] = [match.players[5]!, match.players[0]!];
  const players = match.players.map((p) => ({ ...p, deathsLog: [] as typeof p.deathsLog }));
  players[5] = { ...me, deathsLog: at([100, 200]) };
  players[0] = { ...enemy, deathsLog: at([100 + FIGHT_GAP_S, 200 + FIGHT_GAP_S + 1]) };
  const scores = scoreDeaths({ ...match, players }, players[5]!) ?? [];
  assertEquals(scores.map((s) => s.label), ["even_trade", "caught_alone"]);
});

Deno.test("no deaths log means no fight scores", () => {
  const match = svenGame();
  const me = { ...player(match, 1005), deathsLog: null };
  assertEquals(scoreDeaths({ ...match, players: match.players.map((p) => (p.accountId === 1005 ? me : p)) }, me), null);
});

Deno.test("counts observers standing for each side at a moment", () => {
  const match = svenGame();
  assertEquals(wardsUpAt(match, false, 1321), { ours: 0, theirs: 4 });
  assertEquals(wardsUpAt(match, true, 1321), { ours: 4, theirs: 0 }, "seen from the other side");
});

Deno.test("a match without ward logs claims nothing about wards", () => {
  const raw = fixture("sven-9073477575.json");
  const players = (raw.players as Record<string, unknown>[]).map(({ obs_log: _, ...p }) => p);
  assertEquals(wardsUpAt(readOpenDotaMatch({ ...raw, players }), false, 1321), null);
});

Deno.test("a power rune counts only in the minute before the kill", () => {
  const killer = { ...svenGame().players[0]!, powerRunesS: [300] };
  assertEquals([300, 360, 361, 299].map((t) => tookRuneBefore(killer, t)), [true, true, false, false]);
  assertEquals(tookRuneBefore({ ...killer, powerRunesS: null }, 300), null);
});
