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
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { backtest, engineSuggester, metaSuggester, popularSuggester, toMarkdown } from "../src/backtest/backtest";
import { monthPath } from "../src/data/eval-matches";
import { countPickPhases } from "../src/data/pick-phase";
import { loadEvalGames } from "../src/data/eval-store";
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
  },
});

async function main() {
  const snapshot = JSON.parse(readFileSync(values.snapshot!, "utf8")) as Snapshot;
  const now = Math.floor(Date.now() / 1000);
  const sources = values.matches?.split(",") ?? [monthPath(now - 31 * 24 * 60 * 60), monthPath(now)];
  const builtAt = Date.parse(snapshot.generatedAt) / 1000;
  let games = (await Promise.all([...new Set(sources)].map(loadEvalGames))).flat();
  if (!values["include-seen"]) games = games.filter((g) => g.startTime > builtAt);
  const limit = values.limit ? Number(values.limit) : Infinity;
  if (!(limit > 0)) throw new Error("--limit must be a positive number");
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
  const table = toMarkdown(results, games.length);
  console.log(table);
  if (values.out) writeFileSync(values.out, `${table}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
