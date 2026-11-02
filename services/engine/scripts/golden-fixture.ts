/**
 * Writes test/fixtures/golden-snapshot.json: a hero data snapshot cut down to the golden drafts'
 * heroes, so the golden-draft test runs on real data without the whole snapshot in the repo.
 *
 *   npx tsx scripts/golden-fixture.ts <path to a full snapshot.json with item timings>
 *
 * Rerun it when the golden drafts change, then review the changed files in test/golden/stories/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Snapshot } from "../src/engine/types";
import { GOLDEN_DRAFTS } from "../test/golden/drafts";

const [path] = process.argv.slice(2);
if (!path) throw new Error("Usage: npx tsx scripts/golden-fixture.ts <snapshot.json>");
const full = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
const ids = new Set(GOLDEN_DRAFTS.flatMap((d) => [...d.ours, ...d.theirs]).map(String));

/** Keeps only the entries whose key is one of the golden heroes. */
const pick = <T>(rec: Record<string, T> | undefined): Record<string, T> | undefined =>
  rec && Object.fromEntries(Object.entries(rec).filter(([id]) => ids.has(id)));
/**
 * Matchups keyed hero, then enemy: keeps the golden heroes' whole rows, because the engine reads
 * each hero's win rate in the matchup sample from its whole row.
 */
const pickPairs = <T>(rec: Record<string, Record<string, T>> | undefined) =>
  rec && Object.fromEntries(Object.entries(rec).filter(([id]) => ids.has(id)));
/** Synergy keyed "a-b": keeps pairs of golden heroes. */
const pickSynergy = <T>(rec: Record<string, T> | undefined) =>
  rec && Object.fromEntries(Object.entries(rec).filter(([key]) => key.split("-").every((id) => ids.has(id))));

const fixture: Snapshot = {
  ...full,
  matchups: pickPairs(full.matchups) ?? {},
  synergy: pickSynergy(full.synergy) ?? {},
  rankMatchups: full.rankMatchups && Object.fromEntries(Object.entries(full.rankMatchups).map(([g, m]) => [g, pickPairs(m) ?? {}])),
  rankSynergy: full.rankSynergy && Object.fromEntries(Object.entries(full.rankSynergy).map(([g, s]) => [g, pickSynergy(s) ?? {}])),
  itemBuilds: pick(full.itemBuilds),
  itemTimings: pick(full.itemTimings),
  itemStarts: pick(full.itemStarts),
};
writeFileSync(new URL("../test/fixtures/golden-snapshot.json", import.meta.url), `${JSON.stringify(fixture)}\n`);
console.log(`Wrote the golden snapshot for ${ids.size} heroes.`);
