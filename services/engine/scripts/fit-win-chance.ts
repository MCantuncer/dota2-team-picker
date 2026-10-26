/**
 * Fits the draft win chance on the saved ranked games of this patch and checks it on the newest
 * quarter of them. Only a model that passes the check is written to the snapshot; otherwise any
 * old model is removed, so the website never shows a chance that has not been checked.
 *
 *   npm run fit-win-chance -- [--snapshot data/snapshot.json] [--matches a.json,b.json] [--out check.md] [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkToMarkdown, checkWinModel, fitWinModel, samplesOf } from "../src/backtest/win-fit";
import { loadEvalGames, monthPaths } from "../src/data/eval-store";
import { Engine } from "../src/engine/score";
import type { Snapshot } from "../src/engine/types";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string", default: "data/snapshot.json" },
    matches: { type: "string" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

/** Share of the newest games kept out of the fit to check it. */
const CHECK_SHARE = 0.25;

async function main() {
  const snapshot = JSON.parse(readFileSync(values.snapshot!, "utf8")) as Snapshot;
  const now = Math.floor(Date.now() / 1000);
  const patchStart = snapshot.patch ? Date.parse(snapshot.patch.startedAt) / 1000 : now - 31 * 24 * 60 * 60;
  const sources = values.matches?.split(",") ?? monthPaths(patchStart, now);
  const games = (await Promise.all(sources.map(loadEvalGames)))
    .flat()
    .filter((g) => g.startTime >= patchStart)
    .sort((a, b) => a.startTime - b.startTime);

  const split = Math.floor(games.length * (1 - CHECK_SHARE));
  const engine = new Engine(snapshot);
  const model = fitWinModel(samplesOf(engine, games.slice(0, split)), new Date().toISOString(), split);
  const check = checkWinModel(model, samplesOf(engine, games.slice(split)));
  const report = `Fitted on ${split} games, checked on ${games.length - split} newer ones.\n\n${checkToMarkdown(check)}`;
  console.log(report);
  if (values.out) writeFileSync(values.out, `${report}\n`);

  if (values["dry-run"]) return;
  if (check.passes) snapshot.winModel = model;
  else delete snapshot.winModel;
  writeFileSync(values.snapshot!, JSON.stringify(snapshot));
  console.log(check.passes ? `Saved the win chance model to ${values.snapshot}` : `No win chance model in ${values.snapshot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
