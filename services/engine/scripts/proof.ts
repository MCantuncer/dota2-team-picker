/**
 * Builds the Proof Page numbers (proof.json in the hero-data bucket) from the newest saved ranked
 * games, each scored with the daily hero data copy built before it started. Runs at most once a
 * day: a proof.json newer than --min-age-hours is left as it is.
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run proof -- [--days 28] [--max-games 4000] [--min-age-hours 20] [--json proof.json] [--out summary.md] [--dry-run]
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { copyDays, dailySource, scoreByCopy } from "../src/backtest/live";
import { pickRecords, proofOf, type PickRecord, type Proof } from "../src/backtest/proof";
import { loadEvalGames, loadHeroData, monthPaths } from "../src/data/eval-store";
import { HERO_DATA_URL } from "../src/data/pull";
import { BUCKET } from "../src/data/upload";
import { Engine } from "../src/engine/score";

const { values } = parseArgs({
  options: {
    days: { type: "string", default: "28" },
    "max-games": { type: "string", default: "4000" },
    "min-age-hours": { type: "string", default: "20" },
    json: { type: "string" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const PROOF_PATH = "proof.json";
const PROOF_URL = HERO_DATA_URL.replace(/snapshot\.json$/, PROOF_PATH);
/** Browsers and the CDN may keep the file this long; it changes once a day. */
const MAX_AGE_S = 3600;
const DAY_S = 24 * 60 * 60;

function positive(name: string, value: string | undefined): number {
  const n = Number(value);
  if (!(n > 0) || !Number.isFinite(n)) throw new Error(`--${name} must be a positive number`);
  return n;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** When the published proof.json was computed (Unix ms), or null when there is none. */
async function publishedAt(): Promise<number | null> {
  const res = await fetch(PROOF_URL, { cache: "no-store" });
  // Supabase Storage answers 400 for an object that does not exist.
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`GET ${PROOF_PATH} failed: HTTP ${res.status}`);
  const at = Date.parse(((await res.json()) as Partial<Proof>).computedAt ?? "");
  return Number.isFinite(at) ? at : null;
}

function summary(proof: Proof): string {
  const pts = (x: number | null) => (x === null ? "n/a" : (x * 100).toFixed(1));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const names = { engine: "Our top 3", meta: "Highest win rate", popular: "Most played" } as const;
  return [
    `Proof numbers: ${proof.games} games (${proof.picks} picks) from ${proof.from} to ${proof.to}.`,
    "",
    "| Picks | Top 3 won | Others won | Lift (pts) | Hit top 8 |",
    "| --- | --- | --- | --- | --- |",
    ...(["engine", "meta", "popular"] as const).map((r) => {
      const l = proof.rivals[r];
      return `| ${names[r]} | ${pct(l.top3.won)} (${l.top3.picks}) | ${pct(l.other.won)} (${l.other.picks}) | ${pts(l.lift)} ± ${pts(l.margin)} | ${pct(l.hitTop8)} |`;
    }),
  ].join("\n");
}

async function main() {
  const days = positive("days", values.days);
  const maxGames = positive("max-games", values["max-games"]);
  const minAgeMs = positive("min-age-hours", values["min-age-hours"]) * 3600 * 1000;
  const dryRun = values["dry-run"]!;
  const now = Math.floor(Date.now() / 1000);

  const last = await publishedAt();
  if (!dryRun && last !== null && Date.now() - last < minAgeMs) {
    console.log(`proof.json is from ${new Date(last).toISOString()}, newer than ${values["min-age-hours"]} hours; left as it is.`);
    return;
  }

  const since = now - days * DAY_S;
  const games = (await Promise.all(monthPaths(since, now).map(loadEvalGames)))
    .flat()
    .filter((g) => g.startTime >= since)
    .sort((a, b) => a.startTime - b.startTime)
    .slice(-maxGames);
  if (games.length === 0) throw new Error(`No saved games in the last ${days} days`);

  const records: PickRecord[] = [];
  await scoreByCopy(
    games,
    copyDays(games),
    async (day) => {
      const snapshot = await loadHeroData(dailySource(day));
      return snapshot ? { copy: snapshot, builtAt: Date.parse(snapshot.generatedAt) / 1000 } : null;
    },
    (snapshot, group) => records.push(...pickRecords(new Engine(snapshot), group)),
  );
  const proof = proofOf(records, new Date().toISOString());
  if (!proof) throw new Error("No game could be scored with a hero data copy built before it");

  const text = summary(proof);
  console.log(text);
  if (values.out) writeFileSync(values.out, `${text}\n`);
  const body = JSON.stringify(proof);
  if (values.json) writeFileSync(values.json, body);
  if (dryRun) return;

  const storage = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } }).storage.from(BUCKET);
  const { error } = await storage.upload(PROOF_PATH, body, { contentType: "application/json", cacheControl: String(MAX_AGE_S), upsert: true });
  if (error) throw new Error(`Upload of ${PROOF_PATH} failed: ${error.message}`);
  console.log(`Uploaded ${BUCKET}/${PROOF_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
