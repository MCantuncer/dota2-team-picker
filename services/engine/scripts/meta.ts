/**
 * Builds the Meta page's numbers (meta.json in the hero-data bucket): each hero's games and wins per day of the
 * current patch and the last days of the patch before, per rank group, from the OpenDota explorer (see
 * src/data/meta.ts). Days already complete in the published meta.json are kept, so a run reads only the newest.
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run meta -- [--snapshot data/snapshot.json] [--json meta.json] [--out summary.md] [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { buildMeta, type MetaFile } from "../src/data/meta";
import { getOpenDota } from "../src/data/opendota";
import { HERO_DATA_URL } from "../src/data/pull";
import { BUCKET } from "../src/data/upload";
import type { Snapshot } from "../src/engine/types";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string", default: "data/snapshot.json" },
    json: { type: "string" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const META_PATH = "meta.json";
const META_URL = HERO_DATA_URL.replace(/snapshot\.json$/, META_PATH);
/** Browsers and the CDN may keep the file this long; it changes with each refresh. */
const MAX_AGE_S = 600;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** The published meta.json, or null when there is none or it can't be read (every day is then read again). */
async function published(): Promise<MetaFile | null> {
  const res = await fetch(META_URL, { cache: "no-store" }).catch((err: unknown) => err as Error);
  if (res instanceof Error) {
    console.warn(`GET ${META_PATH} failed, reading every day: ${res.message}`);
    return null;
  }
  // Supabase Storage answers 400 for an object that does not exist.
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    console.warn(`GET ${META_PATH} failed, reading every day: HTTP ${res.status}`);
    return null;
  }
  const body = (await res.json()) as Partial<MetaFile>;
  return Array.isArray(body.days) && Array.isArray(body.base) && body.patch ? (body as MetaFile) : null;
}

/** Tries per explorer query. It answers HTTP 400 when a query times out on days it has not read lately; the next try finds them read. */
const ATTEMPTS = 3;
const RETRY_WAIT_MS = 10_000;

async function ask(sql: string): Promise<unknown> {
  const path = `/explorer?sql=${encodeURIComponent(sql)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const answer = await getOpenDota<{ rows?: unknown; err?: unknown }>(path);
      if (answer.err) throw new Error(`Explorer query failed: ${String(answer.err)}`);
      return answer.rows;
    } catch (err) {
      if (attempt >= ATTEMPTS) throw err;
      console.warn(`Explorer query failed (${(err as Error).message.slice(-40)}), trying again`);
      await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
    }
  }
}

function summary(meta: MetaFile, reread: number): string {
  const games = (days: MetaFile["days"]) => days.reduce((n, d) => n + (d.games[0] ?? 0), 0).toLocaleString("en-US");
  return [
    `Meta numbers for patch ${meta.patch.name}: ${meta.days.length} days, ${games(meta.days)} games; ${meta.base.length} days of the patch before, ${games(meta.base)} games.`,
    `Days read this run: ${reread} (the rest kept from the last meta.json).`,
  ].join("\n");
}

async function main() {
  // The snapshot is written by fetch-data, which checked its shape; only the patch is read here.
  const snapshot = JSON.parse(readFileSync(values.snapshot!, "utf8")) as Pick<Snapshot, "patch">;
  if (!snapshot.patch) throw new Error(`${values.snapshot} has no patch`);
  const last = await published();
  const meta = await buildMeta(ask, snapshot.patch, Math.floor(Date.now() / 1000), last);
  const keptKeys = new Set([...(last?.days ?? []), ...(last?.base ?? [])].filter((d) => d.complete).map((d) => d.from));
  const reread = [...meta.base, ...meta.days].filter((d) => !keptKeys.has(d.from)).length;

  const text = summary(meta, reread);
  console.log(text);
  if (values.out) writeFileSync(values.out, `${text}\n`);
  const body = JSON.stringify(meta);
  if (values.json) writeFileSync(values.json, body);
  if (values["dry-run"]) return;

  const storage = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } }).storage.from(BUCKET);
  const { error } = await storage.upload(META_PATH, body, { contentType: "application/json", cacheControl: String(MAX_AGE_S), upsert: true });
  if (error) throw new Error(`Upload of ${META_PATH} failed: ${error.message}`);
  console.log(`Uploaded ${BUCKET}/${META_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
