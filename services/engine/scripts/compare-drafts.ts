/**
 * Shows the suggestions for a fixed set of drafts, and how a change moves them:
 *
 *   npm run compare-drafts -- [--snapshot data/snapshot.json] [--json after.json] [--before before.json] [--out drafts.md]
 *
 * To compare two versions of the engine, run it on the old one with `--json before.json`, then on
 * the new one with `--before before.json`. The Markdown goes to `--out` or the console.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runDrafts, toMarkdown, type DraftRun } from "../src/backtest/compare-drafts";
import { Engine } from "../src/engine/score";
import type { Snapshot } from "../src/engine/types";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string", default: "data/snapshot.json" },
    json: { type: "string" },
    before: { type: "string" },
    out: { type: "string" },
  },
});

function readRuns(path: string): DraftRun[] {
  const runs: unknown = JSON.parse(readFileSync(path, "utf8"));
  const ok =
    Array.isArray(runs) &&
    runs.every((r: { label?: unknown; cards?: unknown }) => typeof r?.label === "string" && Array.isArray(r.cards));
  if (!ok) throw new Error(`${path} is not a compare-drafts --json file`);
  return runs as DraftRun[]; // Shape checked above.
}

const engine = new Engine(JSON.parse(readFileSync(values.snapshot!, "utf8")) as Snapshot);
const runs = runDrafts(engine);
if (values.json) writeFileSync(values.json, JSON.stringify(runs, null, 2));
const markdown = toMarkdown(runs, values.before ? readRuns(values.before) : undefined);
if (values.out) writeFileSync(values.out, `${markdown}\n`);
else console.log(markdown);
