/**
 * Keeps the draft edges of fair public ranked games up to date (eval/public-edges.json in the
 * hero-data bucket), fits the win range bands on the older three quarters and checks them on the
 * newest quarter. Only bands that pass are written to the snapshot; otherwise any old bands are
 * removed, so the website never shows a range that has not been checked.
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run fit-win-range -- [--snapshot data/snapshot.json] [--store edges.json] [--out check.md] [--dry-run]
 *
 * With --store, the edges are read from and written to that local file instead of the bucket.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { checkWinRange, fitWinRange, rangeCheckToMarkdown, type EdgeSample } from "../src/backtest/win-range";
import { loadHeroData } from "../src/data/eval-store";
import { getOpenDota } from "../src/data/opendota";
import { addEdgeDays, type EdgeDays, type EdgeStore } from "../src/data/public-edges";
import { BUCKET } from "../src/data/upload";
import type { Snapshot } from "../src/engine/types";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string", default: "data/snapshot.json" },
    store: { type: "string" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const STORE_PATH = "eval/public-edges.json";
/** Share of the newest games kept out of the fit to check it. */
const CHECK_SHARE = 0.25;
const FILE_MAX_AGE_S = 60;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function isEdgeDays(x: unknown): x is EdgeDays {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  return Object.values(x).every(
    (rows) => Array.isArray(rows) && rows.every((r) => Array.isArray(r) && typeof r[0] === "number" && (r[1] === 0 || r[1] === 1)),
  );
}

function fileStore(path: string): EdgeStore {
  return {
    async load() {
      if (!existsSync(path)) return {};
      const saved: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isEdgeDays(saved)) throw new Error(`${path} is not a set of public game edges`);
      return saved;
    },
    async save(days) {
      writeFileSync(path, JSON.stringify(days));
    },
  };
}

function bucketStore(): EdgeStore {
  const storage = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } }).storage.from(BUCKET);
  return {
    async load() {
      const { data: files, error: listError } = await storage.list("eval", { search: "public-edges.json" });
      if (listError) throw new Error(`Listing eval failed: ${listError.message}`);
      if (!files.some((f) => f.name === "public-edges.json")) return {};
      const { data, error } = await storage.download(STORE_PATH);
      if (error) throw new Error(`Download of ${STORE_PATH} failed: ${error.message}`);
      const saved: unknown = JSON.parse(await data.text());
      if (!isEdgeDays(saved)) throw new Error(`${STORE_PATH} is not a set of public game edges`);
      return saved;
    },
    async save(days) {
      const { error } = await storage.upload(STORE_PATH, JSON.stringify(days), {
        contentType: "application/json",
        cacheControl: String(FILE_MAX_AGE_S),
        upsert: true,
      });
      if (error) throw new Error(`Upload of ${STORE_PATH} failed: ${error.message}`);
    },
  };
}

async function main() {
  const snapshot = JSON.parse(readFileSync(values.snapshot!, "utf8")) as Snapshot;
  const now = Math.floor(Date.now() / 1000);
  const patchStart = snapshot.patch ? Date.parse(snapshot.patch.startedAt) / 1000 : now - 31 * 24 * 60 * 60;
  const dryRun = values["dry-run"]!;

  const result = await addEdgeDays({
    store: values.store ? fileStore(values.store) : bucketStore(),
    openDota: getOpenDota,
    heroData: loadHeroData,
    now,
    patchStart,
    dryRun,
  });
  for (const { day, games } of result.added) console.log(`Scored ${games} public games from ${day}.`);
  for (const { day, why } of result.skipped) console.warn(`Skipped ${day}: ${why}`);

  const days = Object.keys(result.days).sort();
  const samples: EdgeSample[] = days.flatMap((day) => result.days[day]!.map(([edge, won]) => ({ edge, won: won === 1 })));
  const split = Math.floor(samples.length * (1 - CHECK_SHARE));
  const range = { from: days[0] ?? "", to: days.at(-1) ?? "" };
  const model = fitWinRange(samples.slice(0, split), new Date().toISOString(), range);
  const check = model ? checkWinRange(model, samples.slice(split)) : null;
  const report = check
    ? rangeCheckToMarkdown(check, split)
    : `Win range: only ${samples.length} public games from ${days.length} days, too few to fit; the win range stays hidden.`;
  console.log(report);
  if (values.out) writeFileSync(values.out, `${report}\n`);

  if (dryRun) return;
  if (model && check?.passes) {
    snapshot.winRange = { ...model, check: check.bands.map((b) => ({ games: b.games, won: Math.round(b.won * 10000) / 10000 })) };
  }
  else delete snapshot.winRange;
  writeFileSync(values.snapshot!, JSON.stringify(snapshot));
  console.log(snapshot.winRange ? `Saved the win range to ${values.snapshot}` : `No win range in ${values.snapshot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
