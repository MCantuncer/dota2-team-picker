/**
 * The real My Heroes fill (plan "Auto-Fill My Heroes", step B2): claim, read the player's
 * games, judge them and save, or mark the try as failed so the refresh-trends job retries it.
 * The database side is claim_hero_fill, save_hero_fill and fail_hero_fill.
 */
import { type DryRunDeps, type FillRead, readAndJudge } from "./dry_run.ts";
import type { FillPick } from "./rules.ts";

/** Who starts a fill: the first My Heroes visit, the Fill From My Games button, or the retry job. */
export type FillBy = "welcome" | "button" | "job";
export type SavedState = "done" | "no_games" | "too_few";

/** One pick as save_hero_fill reads it. */
export interface SavedPick {
  position: number;
  hero_id: number;
  kind: "regular" | "proven";
  games: number;
  wins: number;
  strong_games: number;
  judged_games: number;
  /** Unix seconds. */
  last_played: number;
  games_needed: number | null;
}

export interface FillSave {
  result: SavedState;
  positions: number[];
  picks: SavedPick[];
  positionedGames: number;
}

/** The database calls a fill makes, so tests can pass stand-ins. */
export interface FillStore {
  /** True when the fill was claimed (state 'running'). */
  claim: (userId: string, by: FillBy) => Promise<boolean>;
  /** The player's Steam account id, or null without one. */
  steamAccount: (userId: string) => Promise<number | null>;
  /** Heroes added, or null when the fill was no longer running. */
  save: (userId: string, save: FillSave) => Promise<number | null>;
  /** The state after a failed try ('waiting' or 'failed'), or null when no fill was running. */
  fail: (userId: string) => Promise<string | null>;
}

export type FillOutcome =
  | { claimed: false }
  | { claimed: true; state: SavedState | "waiting" | "failed"; added: number };

/** Thrown when a source failed in a way that would make the fill wrong, not just smaller: retry later. */
export class FillSourceError extends Error {}

/**
 * Whether the games read are complete enough to save. A STRATZ failure (with a token set) or a
 * cut-off STRATZ read would lose positions, and without STRATZ OpenDota is the only source.
 */
export function checkSources(sources: FillRead["sources"]): void {
  const { stratz, openDota } = sources;
  if (stratz.status === "failed" || stratz.status === "partial") {
    throw new FillSourceError(`STRATZ read ${stratz.status}`);
  }
  if (stratz.status === "off" && openDota.status !== "ok") {
    throw new FillSourceError(`OpenDota read ${openDota.status} and STRATZ is off`);
  }
}

/** What save_hero_fill gets for a read: no games, too few with a position, or the picks. */
export function toSave(read: FillRead): FillSave {
  const { fill } = read;
  const result: SavedState = read.games.length === 0 ? "no_games" : fill.state === "too_few" ? "too_few" : "done";
  return {
    result,
    positions: result === "done" ? fill.positions : [],
    picks: result === "done" ? fill.picks.map(toSavedPick) : [],
    positionedGames: fill.positionedGames,
  };
}

function toSavedPick(p: FillPick): SavedPick {
  return {
    position: p.position,
    hero_id: p.heroId,
    kind: p.kind,
    games: p.games,
    wins: p.wins,
    strong_games: p.strongGames,
    judged_games: p.judgedGames,
    last_played: Math.round(p.lastPlayed),
    games_needed: p.gamesNeeded,
  };
}

/** Claims and runs one player's fill. Never throws: a failed try is saved as 'waiting' or 'failed'. */
export async function runFill(
  userId: string,
  by: FillBy,
  store: FillStore,
  readDeps: DryRunDeps,
): Promise<FillOutcome> {
  if (!(await store.claim(userId, by))) return { claimed: false };
  try {
    const accountId = await store.steamAccount(userId);
    const save: FillSave = accountId === null
      ? { result: "no_games", positions: [], picks: [], positionedGames: 0 }
      : await readAndCheck(userId, accountId, readDeps);
    const added = await store.save(userId, save);
    return { claimed: true, state: save.result, added: added ?? 0 };
  } catch (err) {
    readDeps.log(`The fill for ${userId} failed; it will be tried again`, err);
    const state = await store.fail(userId).catch((failErr) => {
      readDeps.log(`Marking the fill for ${userId} as failed did not work`, failErr);
      return null;
    });
    return { claimed: true, state: state === "failed" ? "failed" : "waiting", added: 0 };
  }
}

async function readAndCheck(userId: string, accountId: number, deps: DryRunDeps): Promise<FillSave> {
  const read = await readAndJudge(userId, accountId, deps);
  checkSources(read.sources);
  return toSave(read);
}

/** Fills the refresh-trends job retries per run at most. */
export const RETRY_FILLS_PER_RUN = 2;
/** A retry starts only with this much of the retry deadline left: one fill takes about 20 seconds. */
export const RETRY_MIN_LEFT_MS = 25_000;

/** Runs the due fills one after another, and stops starting new ones when time runs short. */
export async function retryDueFills(
  userIds: string[],
  run: (userId: string) => Promise<FillOutcome>,
  timeLeftMs: () => number,
  log: (message: string, err: unknown) => void,
): Promise<{ tried: number; saved: number; failed: number }> {
  const out = { tried: 0, saved: 0, failed: 0 };
  for (const userId of userIds.slice(0, RETRY_FILLS_PER_RUN)) {
    if (timeLeftMs() < RETRY_MIN_LEFT_MS) break;
    const outcome = await run(userId).catch((err) => {
      log(`Claiming the retry fill for ${userId} failed`, err);
      return null;
    });
    if (!outcome?.claimed) continue;
    out.tried++;
    if (outcome.state === "waiting" || outcome.state === "failed") out.failed++;
    else out.saved++;
  }
  return out;
}
