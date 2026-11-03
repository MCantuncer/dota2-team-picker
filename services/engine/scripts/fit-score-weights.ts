/**
 * Learns the score part weights from the saved ranked games of this patch and checks them on the
 * newest quarter (see src/backtest/score-weights.ts). Only weights that pass are written to the
 * snapshot; otherwise any old ones are removed, so the engine falls back to the hand-set weights.
 *
 *   npm run fit-score-weights -- [--snapshot data/snapshot.json] [--matches a.json,b.json] [--out check.md] [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fitAndCheck, liftOf, weightsToMarkdown } from "../src/backtest/score-weights";
import { loadEvalGames, monthPaths } from "../src/data/eval-store";
import type { Snapshot } from "../src/engine/types";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string", default: "data/snapshot.json" },
    matches: { type: "string" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

async function main() {
  const snapshot = JSON.parse(readFileSync(values.snapshot!, "utf8")) as Snapshot;
  const now = Math.floor(Date.now() / 1000);
  const patchStart = snapshot.patch ? Date.parse(snapshot.patch.startedAt) / 1000 : now - 31 * 24 * 60 * 60;
  const sources = values.matches?.split(",") ?? monthPaths(patchStart, now);
  const games = (await Promise.all(sources.map(loadEvalGames)))
    .flat()
    .filter((g) => g.startTime >= patchStart)
    .sort((a, b) => a.startTime - b.startTime);

  const check = fitAndCheck(snapshot, games);
  const report = weightsToMarkdown(check);
  console.log(report);
  if (values.out) writeFileSync(values.out, `${report}\n`);

  if (values["dry-run"]) return;
  if (check.keep && check.weights) {
    snapshot.scoreWeights = {
      fittedAt: new Date().toISOString(),
      picks: check.picks,
      lift: { learned: liftOf(check.results[0]!)!, hand: liftOf(check.results[1]!)! },
      weights: check.weights,
    };
  } else {
    delete snapshot.scoreWeights;
  }
  writeFileSync(values.snapshot!, JSON.stringify(snapshot));
  console.log(check.keep ? `Saved the learned weights to ${values.snapshot}` : `No learned weights in ${values.snapshot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
