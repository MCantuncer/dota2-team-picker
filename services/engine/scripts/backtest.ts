/**
 * Scores the engine and two simple rivals on saved ranked games:
 *
 *   npm run backtest -- [--snapshot data/snapshot.json] [--matches eval/matches-2026-10.json,...] [--limit 500] [--out summary.md]
 *
 * `--matches` takes local files or month files in the hero-data bucket (default: this month and
 * last month). Only games that started after the snapshot was built are scored, so the engine
 * never sees a game it learned from; `--include-seen` turns that off for a quick look.
 *
 * `--pick-phase` counts pick phases from the older half of the games, scores the newer half, and
 * adds an "Engine with pick phase" row next to the engine without them.
 *
 * `--live` scores each game with the bucket's daily copy of the hero data built before it (see
 * src/backtest/live.ts) instead of one snapshot, so it measures the engine on the data the website
 * had. `--snapshot` is then ignored. Both modes also print how well the engine's view of each full
 * draft predicts the winner.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { addResults, backtest, engineSuggester, metaSuggester, popularSuggester, toMarkdown, type BacktestResult } from "../src/backtest/backtest";
import { addDraftScores, draftScoreLine, emptyDraftScore, scoreDrafts } from "../src/backtest/draft-score";
import { copyDays, dailySource, scoreByCopy } from "../src/backtest/live";
import { monthPath, type EvalMatch } from "../src/data/eval-matches";
import { countPickPhases } from "../src/data/pick-phase";
import { loadEvalGames, loadHeroData } from "../src/data/eval-store";
import { Engine } from "../src/engine/score";
import type { Snapshot } from "../src/engine/types";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string", default: "data/snapshot.json" },
    matches: { type: "string" },
    limit: { type: "string" },
    out: { type: "string" },
    "include-seen": { type: "boolean", default: false },
    "pick-phase": { type: "boolean", default: false },
    live: { type: "boolean", default: false },
  },
});

/** The engine and the two rivals on some games with one copy of the hero data. */
function scoreAll(engine: Engine, games: EvalMatch[]): BacktestResult[] {
  return [
    backtest("Engine", engineSuggester(engine), games),
    backtest("Most played", popularSuggester(engine), games),
    backtest("Highest win rate", metaSuggester(engine), games),
  ];
}

async function live(sources: string[], limit: number) {
  let games = (await Promise.all([...new Set(sources)].map(loadEvalGames))).flat();
  games = games.sort((a, b) => a.startTime - b.startTime).slice(-limit);
  if (games.length === 0) throw new Error(`No games to score from ${sources.join(", ")}`);
  let results: BacktestResult[] | null = null;
  let drafts = emptyDraftScore();
  let scored = 0;
  const used: string[] = [];
  await scoreByCopy(
    games,
    copyDays(games),
    async (day) => {
      const snapshot = await loadHeroData(dailySource(day));
      return snapshot ? { copy: { day, snapshot }, builtAt: Date.parse(snapshot.generatedAt) / 1000 } : null;
    },
    ({ day, snapshot }, group) => {
      const engine = new Engine(snapshot);
      const next = scoreAll(engine, group);
      results = results ? results.map((r, i) => addResults(r, next[i]!)) : next;
      drafts = addDraftScores(drafts, scoreDrafts(engine, group));
      scored += group.length;
      used.push(`${day} (${group.length})`);
    },
  );
  if (!results) throw new Error("No daily hero data was built before these games");
  return [
    toMarkdown(results, scored),
    "",
    draftScoreLine(drafts),
    "",
    `Hero data: the daily copy built before each game, ${used.join(", ")}.`,
  ].join("\n");
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const sources = values.matches?.split(",") ?? [monthPath(now - 31 * 24 * 60 * 60), monthPath(now)];
  const limit = values.limit ? Number(values.limit) : Infinity;
  if (!(limit > 0)) throw new Error("--limit must be a positive number");
  if (values.live) {
    if (values["pick-phase"] || values["include-seen"]) throw new Error("--live takes neither --pick-phase nor --include-seen");
    const text = await live(sources, limit);
    console.log(text);
    if (values.out) writeFileSync(values.out, `${text}\n`);
    return;
  }
  const snapshot = JSON.parse(readFileSync(values.snapshot!, "utf8")) as Snapshot;
  const builtAt = Date.parse(snapshot.generatedAt) / 1000;
  let games = (await Promise.all([...new Set(sources)].map(loadEvalGames))).flat();
  if (!values["include-seen"]) games = games.filter((g) => g.startTime > builtAt);
  let counted: typeof games = [];
  if (values["pick-phase"]) {
    const half = Math.floor(games.length / 2);
    counted = games.slice(0, half);
    games = games.slice(half);
  }
  games = games.slice(-limit);
  if (games.length === 0) throw new Error(`No games to score from ${sources.join(", ")} after ${snapshot.generatedAt}`);

  const engine = new Engine(values["pick-phase"] ? { ...snapshot, pickPhase: undefined } : snapshot);
  const results = [backtest("Engine", engineSuggester(engine), games)];
  if (values["pick-phase"]) {
    const withPhase = new Engine({ ...snapshot, pickPhase: countPickPhases(counted) });
    if (withPhase.pickPhaseEdge(withPhase.heroes[0]!.id, 0) === undefined) {
      console.log(`Pick phase: ${counted.length} older games are too few to score with yet.\n`);
    } else {
      results.push(backtest("Engine with pick phase", engineSuggester(withPhase), games));
    }
  }
  results.push(
    backtest("Most played", popularSuggester(engine), games),
    backtest("Highest win rate", metaSuggester(engine), games),
  );
  const table = [toMarkdown(results, games.length), "", draftScoreLine(scoreDrafts(engine, games))].join("\n");
  console.log(table);
  if (values.out) writeFileSync(values.out, `${table}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
