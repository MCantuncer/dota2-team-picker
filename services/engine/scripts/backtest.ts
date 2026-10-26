/**
 * Scores the engine and two simple rivals on saved ranked games:
 *
 *   npm run backtest -- [--snapshot data/snapshot.json] [--matches eval/matches-2026-10.json,...] [--limit 500] [--out summary.md]
 *
 * `--matches` takes local files or month files in the hero-data bucket (default: this month and
 * last month). Only games that started after the snapshot was built are scored, so the engine
 * never sees a game it learned from; `--include-seen` turns that off for a quick look.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { backtest, engineSuggester, metaSuggester, popularSuggester, toMarkdown } from "../src/backtest/backtest";
import { isEvalMatch, monthPath, type EvalMatch } from "../src/data/eval-matches";
import { HERO_DATA_URL } from "../src/data/pull";
import { Engine } from "../src/engine/score";
import type { Snapshot } from "../src/engine/types";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string", default: "data/snapshot.json" },
    matches: { type: "string" },
    limit: { type: "string" },
    out: { type: "string" },
    "include-seen": { type: "boolean", default: false },
  },
});

const BUCKET_URL = HERO_DATA_URL.replace(/snapshot\.json$/, "");

async function load(source: string): Promise<EvalMatch[]> {
  let text: string;
  if (existsSync(source)) {
    text = readFileSync(source, "utf8");
  } else {
    const res = await fetch(BUCKET_URL + source, { cache: "no-store" });
    if (res.status === 404 || res.status === 400) return [];
    if (!res.ok) throw new Error(`GET ${source} failed: HTTP ${res.status}`);
    text = await res.text();
  }
  const list: unknown = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error(`${source} is not a list of games`);
  const games = list.filter(isEvalMatch);
  if (games.length < list.length) console.warn(`${source}: skipped ${list.length - games.length} games with a bad shape`);
  return games;
}

async function main() {
  const snapshot = JSON.parse(readFileSync(values.snapshot!, "utf8")) as Snapshot;
  const now = Math.floor(Date.now() / 1000);
  const sources = values.matches?.split(",") ?? [monthPath(now - 31 * 24 * 60 * 60), monthPath(now)];
  const builtAt = Date.parse(snapshot.generatedAt) / 1000;
  let games = (await Promise.all([...new Set(sources)].map(load))).flat();
  if (!values["include-seen"]) games = games.filter((g) => g.startTime > builtAt);
  const limit = values.limit ? Number(values.limit) : Infinity;
  if (!(limit > 0)) throw new Error("--limit must be a positive number");
  games = games.slice(-limit);
  if (games.length === 0) throw new Error(`No games to score from ${sources.join(", ")} after ${snapshot.generatedAt}`);

  const engine = new Engine(snapshot);
  const results = [
    backtest("Engine", engineSuggester(engine), games),
    backtest("Most played", popularSuggester(engine), games),
    backtest("Highest win rate", metaSuggester(engine), games),
  ];
  const table = toMarkdown(results, games.length);
  console.log(table);
  if (values.out) writeFileSync(values.out, `${table}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
