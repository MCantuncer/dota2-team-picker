/**
 * Uploads data/snapshot.json to the public `hero-data` Supabase Storage bucket:
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run upload-data
 *
 * Writes `snapshot.json` (what the website reads) and `daily/<YYYY-MM-DD>.json`
 * (a copy per day, to compare or roll back).
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Snapshot } from "../engine/types";

const SNAPSHOT_PATH = "data/snapshot.json";
export const BUCKET = "hero-data";
/** Browsers and the CDN may keep the latest file this long. */
const LATEST_MAX_AGE_S = 300;
const DAILY_MAX_AGE_S = 365 * 24 * 60 * 60;

export function dailyPath(snapshot: Snapshot): string {
  return `daily/${snapshot.generatedAt.slice(0, 10)}.json`;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main() {
  const body = readFileSync(SNAPSHOT_PATH, "utf8");
  const snapshot = JSON.parse(body) as Snapshot;
  if (!snapshot.generatedAt || Object.keys(snapshot.heroes).length === 0) {
    throw new Error(`${SNAPSHOT_PATH} looks empty, not uploading`);
  }

  const storage = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false },
  }).storage.from(BUCKET);

  const uploads: [string, number][] = [
    [dailyPath(snapshot), DAILY_MAX_AGE_S],
    ["snapshot.json", LATEST_MAX_AGE_S],
  ];
  for (const [path, maxAge] of uploads) {
    const { error } = await storage.upload(path, body, {
      contentType: "application/json",
      cacheControl: String(maxAge),
      upsert: true,
    });
    if (error) throw new Error(`Upload of ${path} failed: ${error.message}`);
    console.log(`Uploaded ${BUCKET}/${path}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
