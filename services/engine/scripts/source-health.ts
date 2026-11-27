/**
 * Writes the data source issue's body when a source has kept failing for BROKEN_DAYS (see src/data/source-health.ts),
 * and prints the sources still catching up with the patch. The refresh workflow opens or updates one issue from the
 * body, and closes it when the body is empty.
 *
 *   npm run source-health -- --body source-health.md
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { brokenSources, issueBody } from "../src/data/source-health";
import type { Snapshot } from "../src/engine/types";

const { values } = parseArgs({ options: { snapshot: { type: "string", default: "data/snapshot.json" }, body: { type: "string" } } });
if (!values.body) throw new Error("--body is required");
if (!existsSync(values.snapshot!)) throw new Error(`${values.snapshot} not found`);
const snapshot = JSON.parse(readFileSync(values.snapshot!, "utf8")) as Pick<Snapshot, "sourceHealth">;
const now = new Date();
const broken = brokenSources(snapshot.sourceHealth, now);
writeFileSync(values.body, broken.length ? issueBody(broken, now) : "");
for (const [name, s] of Object.entries(snapshot.sourceHealth ?? {})) {
  if (s.state !== "ok") console.log(`${name}: ${s.state} since ${s.since}${s.note ? ` (${s.note})` : ""}`);
}
console.log(broken.length ? `Failing for days: ${broken.map(([n]) => n).join(", ")}.` : "No source failing for days.");
