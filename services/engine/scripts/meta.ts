/**
 * Builds the Meta page's numbers (meta.json in the hero-data bucket): each hero's games and wins per day of the
 * current patch and the last days of the patch before, per rank group, from the OpenDota explorer (see
 * src/data/meta.ts). Days already complete in the published meta.json are kept, so a run reads only the newest.
 * Then the hero card extras: builds and new items from the saved ranked games, matchups from the snapshot (see
 * src/data/meta-extras.ts).
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run meta -- [--snapshot data/snapshot.json] [--json meta.json] [--out summary.md] [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { loadEvalGames, loadHeroData, monthPaths } from "../src/data/eval-store";
import { buildMeta, type MetaFile } from "../src/data/meta";
import { buildExtras, type MetaExtras } from "../src/data/meta-extras";
import { getOpenDota } from "../src/data/opendota";
import { patchNotes, type PatchNotesConstants } from "../src/data/patch-notes";
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

function summary(meta: MetaFile, reread: number, extrasNote: string): string {
  const games = (days: MetaFile["days"]) => days.reduce((n, d) => n + (d.games[0] ?? 0), 0).toLocaleString("en-US");
  return [
    `Meta numbers for patch ${meta.patch.name}: ${meta.days.length} days, ${games(meta.days)} games; ${meta.base.length} days of the patch before, ${games(meta.base)} games.`,
    `Days read this run: ${reread} (the rest kept from the last meta.json).`,
    extrasNote,
  ].join("\n");
}

const DAY_S = 24 * 60 * 60;

/** Builds, new items and matchups. A failure keeps the published extras of the same patch, so the day numbers still go out. */
async function extras(snapshot: Pick<Snapshot, "patch" | "items" | "matchups">, now: number, last: MetaFile | null): Promise<[MetaExtras | undefined, string]> {
  try {
    const built = await buildExtras(
      {
        games: async (since, to) => (await Promise.all(monthPaths(since, to).map(loadEvalGames))).flat(),
        itemsBefore: async (patchStart) => {
          const day = new Date((patchStart - DAY_S) * 1000).toISOString().slice(0, 10);
          return (await loadHeroData(`daily/${day}.json`))?.items ?? null;
        },
        patchNotes: async (patch) => {
          const [notes, heroes, abilities] = await Promise.all([
            getOpenDota<PatchNotesConstants>("/constants/patchnotes"),
            getOpenDota<Record<string, { id?: number; name?: string }>>("/constants/heroes"),
            getOpenDota<Record<string, { dname?: string }>>("/constants/abilities"),
          ]);
          const heroNames = Object.fromEntries(Object.values(heroes).flatMap((h) => (h.id && h.name ? [[String(h.id), h.name]] : [])));
          const abilityNames = Object.fromEntries(Object.entries(abilities).flatMap(([key, a]) => (a.dname ? [[key, a.dname]] : [])));
          return patchNotes(notes, patch, heroNames, abilityNames);
        },
      },
      snapshot,
      now,
      last,
    );
    const heroes = Object.keys(built.builds).length;
    const names = built.newItems.map((n) => `${snapshot.items?.[n.id]?.name ?? n.id} ${n.games}`).join(", ");
    return [
      built,
      `Builds: ${built.buildGames.toLocaleString("en-US")} saved games with items, ${heroes} heroes with a build. New items (games): ${names || "none"}. Matchups for ${Object.keys(built.matchups).length} heroes. Patch notes for ${Object.keys(built.patchNotes).length} heroes.`,
    ];
  } catch (err) {
    console.warn(`Hero card extras failed, keeping the last ones: ${(err as Error).message}`);
    const kept = last?.patch.name === snapshot.patch?.name ? last?.extras : undefined;
    return [kept, `Hero card extras failed (${(err as Error).message}); ${kept ? "kept the last ones" : "none published"}.`];
  }
}

async function main() {
  // The snapshot is written by fetch-data, which checked its shape.
  const snapshot = JSON.parse(readFileSync(values.snapshot!, "utf8")) as Pick<Snapshot, "patch" | "positions" | "items" | "matchups">;
  if (!snapshot.patch) throw new Error(`${values.snapshot} has no patch`);
  const last = await published();
  const now = Math.floor(Date.now() / 1000);
  const meta = await buildMeta(ask, snapshot.patch, now, last, snapshot.positions);
  const [built, extrasNote] = await extras(snapshot, now, last);
  if (built) meta.extras = built;
  const keptKeys = new Set([...(last?.days ?? []), ...(last?.base ?? [])].filter((d) => d.complete).map((d) => d.from));
  const reread = [...meta.base, ...meta.days].filter((d) => !keptKeys.has(d.from)).length;

  const text = summary(meta, reread, extrasNote);
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
