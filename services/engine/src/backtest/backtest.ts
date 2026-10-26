/**
 * Scores a suggester on real ranked games it never learned from. At every pick, it sees only
 * what that player saw (the bans, the picks made before, the allies' positions, the rank) and
 * suggests heroes for the player's position. Two numbers come out:
 *
 * - hit rate: how often the hero the player really took is in the top 8 (and the top 1).
 *   It shows the advice is realistic, not that it is good.
 * - win lift: the win rate of players who took one of the top 3, against players who did not.
 *   This is the number that says whether following the advice wins games.
 *
 * Simple rivals (most played in the position, highest win rate) are scored the same way, so
 * the engine has something to beat.
 */
import type { EvalMatch } from "../data/eval-matches";
import { Engine } from "../engine/score";
import type { DraftInput, RankBracket } from "../engine/types";

/** Anything that turns a draft into an ordered list of hero ids. */
export type Suggester = (input: DraftInput) => number[];

/** Results for one suggester. Win rates are null when no pick fell in that group. */
export interface BacktestResult {
  name: string;
  /** Picks scored: those whose player has a known position. */
  picks: number;
  hitTop1: number;
  hitTop8: number;
  /** Win rate (0-1) and count of picks in the top 3, and of the rest. */
  top3: { picks: number; winRate: number | null };
  other: { picks: number; winRate: number | null };
}

const TOP = 8;
const LIFT_TOP = 3;

/** The rank bracket (1 Herald ... 8 Immortal) of an OpenDota rank tier like 54, if there is one. */
export function bracketOf(rankTier: number | null): RankBracket | undefined {
  const medal = Math.floor((rankTier ?? 0) / 10);
  return medal >= 1 && medal <= 8 ? (medal as RankBracket) : undefined;
}

/** The draft as the player making pick `index` saw it. */
export function draftAt(match: EvalMatch, index: number, count = TOP): DraftInput | null {
  const pick = match.picks[index];
  if (!pick?.position) return null;
  const before = match.picks.slice(0, index);
  return {
    myPosition: pick.position,
    allies: before
      .filter((p) => p.radiant === pick.radiant)
      .map((p) => (p.position ? { heroId: p.heroId, position: p.position } : { heroId: p.heroId })),
    enemies: before.filter((p) => p.radiant !== pick.radiant).map((p) => p.heroId),
    bans: match.bans,
    rankBracket: bracketOf(match.rankTier),
    count,
  };
}

/** Runs one suggester over every pick with a known position. */
export function backtest(name: string, suggest: Suggester, matches: EvalMatch[]): BacktestResult {
  let picks = 0;
  let hitTop1 = 0;
  let hitTop8 = 0;
  const groups = { top3: { picks: 0, wins: 0 }, other: { picks: 0, wins: 0 } };
  for (const match of matches) {
    match.picks.forEach((pick, i) => {
      const input = draftAt(match, i);
      if (!input) return;
      const list = suggest(input).slice(0, TOP);
      const at = list.indexOf(pick.heroId);
      picks++;
      if (at === 0) hitTop1++;
      if (at >= 0) hitTop8++;
      const group = at >= 0 && at < LIFT_TOP ? groups.top3 : groups.other;
      group.picks++;
      if (pick.radiant === match.radiantWin) group.wins++;
    });
  }
  const rate = (g: { picks: number; wins: number }) => ({ picks: g.picks, winRate: g.picks ? g.wins / g.picks : null });
  return {
    name,
    picks,
    hitTop1: picks ? hitTop1 / picks : 0,
    hitTop8: picks ? hitTop8 / picks : 0,
    top3: rate(groups.top3),
    other: rate(groups.other),
  };
}

/** Heroes the player could still take in this draft. */
function open(engine: Engine, input: DraftInput) {
  const taken = new Set([...input.allies.map((a) => a.heroId), ...input.enemies, ...(input.bans ?? [])]);
  return engine.heroes.filter((h) => !taken.has(h.id));
}

/** The engine itself. */
export const engineSuggester =
  (engine: Engine): Suggester =>
  (input) =>
    engine.suggest(input).map((s) => s.heroId);

/** Rival: the heroes most often played in the position (games picked times position fit). */
export const popularSuggester = (engine: Engine): Suggester => {
  const picks = (id: number) => (engine.data.bracketStats[id]?.picks ?? []).reduce((n, x) => n + x, 0);
  return (input) =>
    open(engine, input)
      .map((h) => ({ id: h.id, value: picks(h.id) * engine.fit(h.id)[input.myPosition] }))
      .sort((a, b) => b.value - a.value)
      .map((h) => h.id);
};

/** Rival: the highest win rate at the player's rank among heroes that are a real fit for the position. */
export const metaSuggester =
  (engine: Engine, minFit = 0.15): Suggester =>
  (input) =>
    open(engine, input)
      .filter((h) => engine.fit(h.id)[input.myPosition] >= minFit)
      .map((h) => ({ id: h.id, value: engine.winRate(h.id, input.rankBracket) }))
      .sort((a, b) => b.value - a.value)
      .map((h) => h.id);

/** A Markdown table of results, for the console and the CI job summary. */
export function toMarkdown(results: BacktestResult[], games: number): string {
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  const lift = (r: BacktestResult) =>
    r.top3.winRate === null || r.other.winRate === null ? "n/a" : `${((r.top3.winRate - r.other.winRate) * 100).toFixed(1)} pts`;
  const rows = results.map(
    (r) =>
      `| ${r.name} | ${pct(r.hitTop1)} | ${pct(r.hitTop8)} | ${pct(r.top3.winRate)} (${r.top3.picks}) | ${pct(r.other.winRate)} (${r.other.picks}) | ${lift(r)} |`,
  );
  return [
    `Backtest on ${games} games, ${results[0]?.picks ?? 0} picks with a known position.`,
    "",
    "| Suggester | Hit top 1 | Hit top 8 | Win rate, took a top 3 (picks) | Win rate, other picks | Win lift |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
