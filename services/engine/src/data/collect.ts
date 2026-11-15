/**
 * Saves recent ranked All Pick games for the engine backtest:
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... STRATZ_TOKEN=... npm run collect-matches -- [--max 100] [--dry-run]
 *
 * Draws recent ranked games at random from the OpenDota explorer, asks OpenDota for the pick
 * order of up to `--max` new ones and STRATZ for each player's position, and adds them to one file
 * per month in the `hero-data` bucket (`eval/matches-<YYYY-MM>.json`). STRATZ may not
 * have placed a game that just ended, so each run also asks again for recent saved
 * games that still miss positions. Without STRATZ_TOKEN, positions stay empty.
 */
import { createClient } from "@supabase/supabase-js";
import type { PublicMatch } from "./fetch";
import { getOpenDota, requestsLeftToday } from "./opendota";
import { fetchMatchPositions } from "./stratz";
import { BUCKET } from "./upload";
import type { Position } from "../engine/types";
import { isCandidate, mergeMatches, monthPath, toEvalMatch, type EvalMatch, type MatchDetail } from "./eval-matches";

/** Leave this many OpenDota requests for the data refresh and other users of the runner's IP. */
const DAILY_RESERVE = 300;
/**
 * Candidates come from games that started between these many seconds ago, so they have ended.
 * The /publicMatches feed was not a fair sample: Radiant won 60.5% of the 2,297 games saved from it
 * up to 2026-11-14, against 53.0% of 80,514 explorer games over the same days, so the explorer is used.
 */
export const CANDIDATE_WINDOW_S = { from: 8 * 60 * 60, to: 2 * 60 * 60 };
/** One match id in this many is read from the window: about 1,500 rows, plenty for --max. */
export const SAMPLE_EVERY = 50;
const SAMPLE_ROWS = 3000;
/** Ask STRATZ again for games up to this old that still miss positions. */
const POSITION_RETRY_S = 3 * 24 * 60 * 60;
const FILE_MAX_AGE_S = 300;

/** Where month files are read from and written to. */
export interface MonthStore {
  /** The saved games in a month file, or an empty list when it does not exist yet. */
  load(path: string): Promise<EvalMatch[]>;
  save(path: string, matches: EvalMatch[]): Promise<void>;
}

/** Everything a collector run talks to, so tests can pass fakes. */
export interface CollectDeps {
  store: MonthStore;
  openDota: <T>(path: string) => Promise<T>;
  requestsLeft: () => number;
  /** Positions by hero for each match id, or null when there is no STRATZ token. */
  matchPositions: ((ids: number[]) => Promise<Map<number, Map<number, Position>>>) | null;
  /** Unix seconds. */
  now: number;
  max: number;
  dryRun: boolean;
}

export interface CollectResult {
  candidates: number;
  added: EvalMatch[];
  /** Older games whose positions are now complete. */
  filled: number;
  /** Month files written (or that a dry run would write), with how many games each holds. */
  written: { path: string; games: number }[];
}

/**
 * The explorer query for a random slice of ranked All Pick games over 15 minutes that started in the
 * window. `slice` (0 to SAMPLE_EVERY - 1) picks which match ids, so every run reads a different slice.
 */
export function candidateQuery(now: number, slice: number): string {
  const from = Math.floor(now - CANDIDATE_WINDOW_S.from);
  const to = Math.floor(now - CANDIDATE_WINDOW_S.to);
  return (
    "select match_id, radiant_win, duration, lobby_type, game_mode, start_time, avg_rank_tier, radiant_team, dire_team " +
    `from public_matches where lobby_type = 7 and game_mode = 22 and duration >= 900 and start_time >= ${from} and start_time < ${to} ` +
    `and match_id % ${SAMPLE_EVERY} = ${slice} limit ${SAMPLE_ROWS}`
  );
}

/** Shuffles a copy of `list` with a small seeded generator, so a run's order does not follow match ids. */
export function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = Math.floor(seed) % 2147483647 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Recent finished ranked All Pick games, a random sample of all of them, in random order. */
async function findCandidates(deps: CollectDeps, skip: (id: number) => boolean): Promise<PublicMatch[]> {
  if (deps.requestsLeft() < DAILY_RESERVE) return [];
  const slice = Math.floor(deps.now / 60) % SAMPLE_EVERY;
  const answer = await deps.openDota<{ rows?: unknown; err?: unknown }>(
    `/explorer?sql=${encodeURIComponent(candidateQuery(deps.now, slice))}`,
  );
  if (answer.err) throw new Error(`Explorer query failed: ${String(answer.err)}`);
  if (!Array.isArray(answer.rows)) throw new Error("Explorer answer has no rows");
  const rows = (answer.rows as PublicMatch[]).filter((m) => isCandidate(m) && !skip(m.match_id));
  return shuffled(rows, deps.now).slice(0, deps.max);
}

/** One collector run: find new games, fetch their drafts and positions, and save the changed months. */
export async function collectMatches(deps: CollectDeps): Promise<CollectResult> {
  const months = new Map<string, EvalMatch[]>();
  const month = async (path: string) => {
    // Never write a month file that was not read first.
    if (!months.has(path)) months.set(path, await deps.store.load(path));
    return months.get(path)!;
  };
  for (const path of new Set([monthPath(deps.now - POSITION_RETRY_S), monthPath(deps.now)])) await month(path);
  const savedIds = new Set([...months.values()].flat().map((m) => m.id));

  const candidates = await findCandidates(deps, (id) => savedIds.has(id));
  const details: { detail: MatchDetail; rankTier: number | null }[] = [];
  for (const c of candidates) {
    if (deps.requestsLeft() < DAILY_RESERVE) {
      console.log(`Stopping: only ${deps.requestsLeft()} OpenDota requests left today.`);
      break;
    }
    try {
      details.push({
        detail: await deps.openDota<MatchDetail>(`/matches/${c.match_id}`),
        rankTier: c.avg_rank_tier ?? null,
      });
    } catch (err) {
      // One missing game does not matter for the backtest; keep the rest.
      console.warn(`Skipping match ${c.match_id}: ${(err as Error).message}`);
    }
  }

  const retry = [...months.values()]
    .flat()
    .filter((m) => m.startTime >= deps.now - POSITION_RETRY_S && m.picks.some((p) => !p.position));
  let positions = new Map<number, Map<number, Position>>();
  const ids = [...details.map((d) => d.detail.match_id), ...retry.map((m) => m.id)];
  if (deps.matchPositions && ids.length) {
    try {
      positions = await deps.matchPositions(ids);
    } catch (err) {
      // Positions are filled in on a later run, so save the games without them.
      console.warn(`::warning::${(err as Error).message}`);
    }
  }

  const changed = new Set<string>();
  let filled = 0;
  for (const m of retry) {
    const found = positions.get(m.id);
    if (!found) continue;
    for (const p of m.picks) p.position ??= found.get(p.heroId) ?? null;
    if (m.picks.every((p) => p.position)) filled++;
    changed.add(monthPath(m.startTime));
  }

  const added: EvalMatch[] = [];
  for (const { detail, rankTier } of details) {
    const match = toEvalMatch(detail, rankTier, positions.get(detail.match_id));
    if (!match) continue;
    const path = monthPath(match.startTime);
    months.set(path, mergeMatches(await month(path), [match]));
    changed.add(path);
    added.push(match);
  }

  const written: CollectResult["written"] = [];
  for (const path of changed) {
    const list = months.get(path)!; // Every changed path was loaded through month() above.
    if (!deps.dryRun) await deps.store.save(path, list);
    written.push({ path, games: list.length });
  }
  return { candidates: candidates.length, added, filled, written };
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Month files in the public `hero-data` bucket, written with the service key. */
function bucketStore(): MonthStore {
  const storage = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false },
  }).storage.from(BUCKET);
  return {
    async load(path) {
      const [folder, name] = path.split("/") as [string, string]; // monthPath always returns "eval/<file>".
      const { data: files, error: listError } = await storage.list(folder, {
        search: name,
      });
      if (listError) throw new Error(`Listing ${folder} failed: ${listError.message}`);
      if (!files.some((f) => f.name === name)) return [];
      const { data, error } = await storage.download(path);
      if (error) throw new Error(`Download of ${path} failed: ${error.message}`);
      const saved: unknown = JSON.parse(await data.text());
      if (!Array.isArray(saved)) throw new Error(`${path} is not a list of matches`);
      // Written only by this script with the service key, so a list has the saved shape.
      return saved as EvalMatch[];
    },
    async save(path, matches) {
      const { error } = await storage.upload(path, JSON.stringify(matches), {
        contentType: "application/json",
        cacheControl: String(FILE_MAX_AGE_S),
        upsert: true,
      });
      if (error) throw new Error(`Upload of ${path} failed: ${error.message}`);
    },
  };
}

async function main() {
  const maxArg = process.argv.indexOf("--max");
  const max = maxArg > 0 ? Number(process.argv[maxArg + 1]) : 100;
  if (!Number.isInteger(max) || max < 1 || max > 1000) throw new Error("--max must be a whole number from 1 to 1000");
  const dryRun = process.argv.includes("--dry-run");
  const token = process.env.STRATZ_TOKEN;
  if (!token) console.log("No STRATZ_TOKEN, saving games without positions.");

  const result = await collectMatches({
    store: bucketStore(),
    openDota: getOpenDota,
    requestsLeft: requestsLeftToday,
    matchPositions: token ? (ids) => fetchMatchPositions(token, ids) : null,
    now: Math.floor(Date.now() / 1000),
    max,
    dryRun,
  });
  const complete = result.added.filter((m) => m.picks.every((p) => p.position)).length;
  console.log(
    `Saved ${result.added.length} of ${result.candidates} candidate games (${complete} with all positions), ` +
      `filled positions for ${result.filled} older games.`,
  );
  for (const { path, games } of result.written) {
    console.log(`${dryRun ? "Dry run, would upload" : "Uploaded"} ${BUCKET}/${path} (${games} games).`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
