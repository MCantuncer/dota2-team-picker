/**
 * Fills the matchup cache ahead of drafts, so the item measurement (item engine plan, step 4) has games to
 * judge: the most played heroes of each position against every enemy, through the live lookup itself
 * (lookupMatchups), so it waits for the hero data refresh and stops on a 429 like a user's lookup.
 * Can chose 2026-11-11: the 10 most played heroes of each position first, then every hero.
 *
 * Run hourly by the "Matchup backfill" workflow:
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... STRATZ_TOKEN=... deno run --allow-net --allow-env backfill.ts
 *
 * It takes STRATZ calls from the shared hourly budget only up to BACKFILL_HOURLY_CAP, so users' lookups
 * keep the rest. Fresh cache rows are skipped, so each run carries on where the last one stopped.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type CachedSlice, type LookupDeps, lookupMatchups } from "./lookup.ts";
import type { MatchupGame, Slice } from "./queries.ts";
import { postStratz } from "./stratz.ts";

/** Heroes of each position to fill, most played first. */
export const HEROES_PER_POSITION = 10;
/** The backfill stops taking STRATZ calls once this UTC hour's calls (users' and its own) reach this, of 600. */
export const BACKFILL_HOURLY_CAP = 400;
/** A run started at :40 stops by about :10, before the hero data refresh (02, 06, 10 and 14:17 UTC) starts. */
const RUN_MS = 30 * 60 * 1000;
/** Enemies per lookup: the most one lookup takes. */
const ENEMIES_PER_LOOKUP = 5;
/** Kept as long as the matchup-builds function reads them. */
const KEEP_DAYS = 14;
const SNAPSHOT_URL = "https://odigcdwsvajkbvcxeskj.supabase.co/storage/v1/object/public/hero-data/snapshot.json";

/** The parts of the published snapshot the backfill reads. */
export interface BackfillSnapshot {
  heroes: Record<string, unknown>;
  /** itemTimings[hero][position].all.games: how often the hero is played there. */
  itemTimings?: Record<string, Record<string, { all?: { games?: number } }>>;
  skillBuilds?: Record<string, Record<string, { gameVersionId?: number } | undefined>>;
}

/** One lookup of the backfill: one hero at a position against up to five enemies. */
export interface BackfillLookup {
  hero: number;
  position: number;
  enemies: number[];
}

/**
 * The lookups to make, in order: `first` (a question waiting on one hero, like Slark's Mage Slayer), then
 * the most played hero of each position (positions taking turns), each against every other hero, five at a time.
 */
export function backfillPlan(
  snapshot: BackfillSnapshot,
  perPosition = HEROES_PER_POSITION,
  first: { hero: number; position: number }[] = [],
): BackfillLookup[] {
  const heroes = Object.keys(snapshot.heroes).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  const games = (hero: number, position: number) => snapshot.itemTimings?.[hero]?.[position]?.all?.games ?? 0;
  const byPosition = [1, 2, 3, 4, 5].map((position) =>
    heroes.filter((h) => games(h, position) > 0)
      .sort((a, b) => games(b, position) - games(a, position) || a - b)
      .slice(0, perPosition)
      .map((hero) => ({ hero, position }))
  );
  const order = first.filter((f) => heroes.includes(f.hero) && f.position >= 1 && f.position <= 5);
  const listed = (o: { hero: number; position: number }) =>
    order.some((f) => f.hero === o.hero && f.position === o.position);
  for (let i = 0; i < perPosition; i++) {
    for (const list of byPosition) {
      const next = list[i];
      if (next && !listed(next)) order.push(next);
    }
  }
  return order.flatMap(({ hero, position }) => {
    const enemies = heroes.filter((e) => e !== hero);
    const out: BackfillLookup[] = [];
    for (let i = 0; i < enemies.length; i += ENEMIES_PER_LOOKUP) {
      out.push({ hero, position, enemies: enemies.slice(i, i + ENEMIES_PER_LOOKUP) });
    }
    return out;
  });
}

/** The first STRATZ game version of the current patch, as the site sends it (latestSkillVersion). */
export function patchVersion(snapshot: BackfillSnapshot): number {
  let latest = 0;
  for (const byPosition of Object.values(snapshot.skillBuilds ?? {})) {
    for (const s of Object.values(byPosition ?? {})) latest = Math.max(latest, s?.gameVersionId ?? 0);
  }
  return latest;
}

/** Why a run stops early: STRATZ is busy or this hour's share is spent. */
const STOPS = new Set(["stratz-busy", "stratz-budget"]);
/** A failed lookup is skipped (the next run tries it again); this many in a row stop the run. */
export const MAX_FAILURES_IN_A_ROW = 3;

/** Runs the plan until it is done, a lookup says STRATZ can't be asked now, or `until`. */
export async function runBackfill(
  deps: LookupDeps,
  plan: BackfillLookup[],
  version: number,
  until: number,
): Promise<{ lookups: number; fresh: number; games: number; failed: number; stoppedBy?: string }> {
  let lookups = 0, fresh = 0, games = 0, failed = 0, inARow = 0;
  for (const step of plan) {
    if (deps.now() >= until) return { lookups, fresh, games, failed, stoppedBy: "time" };
    const result = await lookupMatchups(deps, {
      ours: [{ hero: step.hero, position: step.position }],
      theirs: step.enemies,
      version,
    });
    lookups++;
    for (const s of result.slices) {
      if (!s.stale) {
        fresh++;
        games += s.games.length;
      }
    }
    const stop = result.reasons.find((r) => STOPS.has(r));
    if (stop) return { lookups, fresh, games, failed, stoppedBy: stop };
    if (result.reasons.includes("stratz-failed")) {
      failed++;
      if (++inARow >= MAX_FAILURES_IN_A_ROW) return { lookups, fresh, games, failed, stoppedBy: "stratz-failed" };
    } else {
      inARow = 0;
    }
  }
  return { lookups, fresh, games, failed };
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main() {
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const token = env("STRATZ_TOKEN");
  const res = await fetch(SNAPSHOT_URL);
  if (!res.ok) throw new Error(`Downloading the snapshot failed: HTTP ${res.status}`);
  // The published snapshot has these fields (engine Snapshot); missing ones only shorten the plan.
  const snapshot = (await res.json()) as BackfillSnapshot;
  const version = patchVersion(snapshot);
  if (!version) throw new Error("The snapshot has no game version");
  const perPosition = Number(Deno.env.get("HEROES_PER_POSITION") ?? HEROES_PER_POSITION);
  if (!Number.isSafeInteger(perPosition) || perPosition < 1) throw new Error("HEROES_PER_POSITION must be 1 or more");
  // FIRST is "hero:position" pairs, comma separated, like "93:1".
  const first = (Deno.env.get("FIRST") ?? "").split(",").filter(Boolean).map((pair) => {
    const [hero, position] = pair.split(":").map(Number);
    if (
      hero === undefined || position === undefined || !Number.isSafeInteger(hero) || !Number.isSafeInteger(position)
    ) {
      throw new Error(`Bad FIRST entry ${pair}`);
    }
    return { hero, position };
  });
  const plan = backfillPlan(snapshot, perPosition, first);

  const toJson = (slices: Slice[]) => slices.map((s) => ({ hero: s.hero, position: s.position, enemy: s.enemy }));
  const deps: LookupDeps = {
    async freeAt() {
      const { data, error } = await admin.rpc("stratz_free_at");
      if (error) throw error;
      return data;
    },
    // A 429 here may be the backfill's own address or volume, so it stops this run without holding users'
    // lookups back; if STRATZ refuses them too, their own 429 holds every lookup back.
    noteBusy: () => Promise.resolve(),
    async readCache(heroes, enemies, v) {
      const since = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await admin.from("matchup_guides")
        .select("hero_id, position, enemy_id, games, fetched_at")
        .in("hero_id", heroes).in("enemy_id", enemies).eq("game_version", v).gte("fetched_at", since);
      if (error) throw error;
      return (data ?? []).map((r): CachedSlice => ({
        hero: r.hero_id,
        position: r.position,
        enemy: r.enemy_id,
        // Written only by save_matchup_guides with games from toMatchupGame.
        games: r.games as unknown as MatchupGame[],
        fetchedAt: r.fetched_at,
      }));
    },
    // No user is behind the backfill; its limit is BACKFILL_HOURLY_CAP.
    takeLookup: () => Promise.resolve(true),
    async claim(slices, v) {
      const { data, error } = await admin.rpc("claim_matchup_fetches", { wanted: toJson(slices), version: v });
      if (error) throw error;
      // claim_matchup_fetches returns the claimed slices in the shape it was given.
      return (data ?? []) as unknown as Slice[];
    },
    async takeStratz(calls) {
      const { data, error } = await admin.rpc("take_stratz_calls", { wanted: calls, hourly_cap: BACKFILL_HOURLY_CAP });
      if (error || data === null) throw error ?? new Error("No answer from take_stratz_calls");
      return data;
    },
    async save(slices, v) {
      const { error } = await admin.rpc("save_matchup_guides", {
        slices: slices.map((s) => ({ hero: s.hero, position: s.position, enemy: s.enemy, games: s.games })),
        version: v,
      });
      if (error) throw error;
    },
    post: (query, timeoutMs) => postStratz(token, query, timeoutMs),
    now: () => Date.now(),
  };

  const done = await runBackfill(deps, plan, version, Date.now() + RUN_MS);
  console.log(
    `version ${version}: ${plan.length} lookups planned (${perPosition} heroes per position); ` +
      `made ${done.lookups} (${done.failed} failed); ${done.fresh} slices now fresh, with ${done.games} games` +
      (done.stoppedBy ? `; stopped: ${done.stoppedBy}` : "; the plan is done"),
  );
  // Shown on the run page, so lookups failing again and again don't go unseen.
  if (done.failed > 0) console.log(`::warning::${done.failed} backfill lookups failed; see the log above`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    Deno.exit(1);
  });
}
