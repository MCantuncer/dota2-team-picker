/**
 * One run of the build-reports job: first look for the matches of drafts nobody looked up,
 * then build the reports that are due, then look for the games of started solo boards (game
 * check-ins), then delete saved matches older than 90 days or without a report and check-ins
 * older than 180 days. Every OpenDota call is taken from the daily budget
 * first, and a run makes at most MAX_RUN_CALLS of them. The run stops when the budget is
 * used up or OpenDota rate limits; what was left is picked up next run.
 */
import { findCalls, type FoundMatch } from "../attach.ts";
import { CHECK_IN_CALLS, type CheckInFind, type SoloCheckIn } from "../check_in.ts";
import { type ClaimedReport, OpenDotaBusy, type ReportUpdate } from "./build.ts";

export const MAX_RUN_CALLS = 30;
/** A report fetches the match and may ask for a parse. */
const REPORT_CALLS = 2;
/** Check-ins get their own small share per run, after the reports, so they never starve them. */
export const CHECK_IN_RUN_CALLS = 8;

/** A draft `claim_unattached_drafts` handed out. */
export interface UnattachedDraft {
  draft_id: string;
  created_at: string;
  allies: number[];
  account_ids: number[];
}

export interface JobDeps {
  /** Takes calls from the daily budget; false when refused or the check failed. */
  takeCalls: (n: number) => Promise<boolean>;
  claimDrafts: () => Promise<UnattachedDraft[]>;
  findMatch: (draft: UnattachedDraft) => Promise<FoundMatch | null>;
  /** False when someone else attached a match first. */
  attach: (draftId: string, found: FoundMatch) => Promise<boolean>;
  claimReports: () => Promise<ClaimedReport[]>;
  build: (report: ClaimedReport) => Promise<ReportUpdate>;
  save: (draftId: string, update: ReportUpdate) => Promise<void>;
  claimCheckIns: () => Promise<SoloCheckIn[]>;
  findCheckIn: (board: SoloCheckIn) => Promise<CheckInFind>;
  /** False when the board already had a result. */
  saveCheckIn: (id: string, found: FoundMatch) => Promise<boolean>;
  /** Notes a search that found no recent games at all. */
  noteNoGames: (id: string) => Promise<void>;
  /** Deletes stale saved matches; returns how many. */
  cleanFiles: () => Promise<number>;
  /** Deletes check-ins older than 180 days; returns how many. */
  forgetCheckIns: () => Promise<number>;
  log: (message: string, err?: unknown) => void;
}

export interface RunResult {
  attached: number;
  built: number;
  /** Solo boards whose game was found. */
  checkIns: number;
  removedFiles: number;
  removedCheckIns: number;
  calls: number;
  /** Why the run ended early, if it did. */
  stopped: "run cap" | "daily budget" | "rate limit" | null;
}

export async function runJob(deps: JobDeps, maxCalls = MAX_RUN_CALLS): Promise<RunResult> {
  const result = await findAndBuild(deps, maxCalls);
  if (result.stopped === null || result.stopped === "run cap") await findCheckIns(deps, result);
  // No OpenDota calls, so these run even when the budget or a rate limit stopped the rest.
  try {
    result.removedFiles = await deps.cleanFiles();
  } catch (err) {
    deps.log("Deleting old saved matches failed", err);
  }
  try {
    result.removedCheckIns = await deps.forgetCheckIns();
  } catch (err) {
    deps.log("Deleting old check-ins failed", err);
  }
  return result;
}

/** Looks for the games of started solo boards, within CHECK_IN_RUN_CALLS calls. */
async function findCheckIns(deps: JobDeps, result: RunResult): Promise<void> {
  let calls = 0;
  let boards: SoloCheckIn[];
  try {
    boards = await deps.claimCheckIns();
  } catch (err) {
    deps.log("Claiming check-ins failed", err);
    return;
  }
  // Boards claimed but not searched are tried again at their next gap.
  for (const board of boards) {
    if (calls + CHECK_IN_CALLS > CHECK_IN_RUN_CALLS) return;
    if (!(await deps.takeCalls(CHECK_IN_CALLS))) {
      result.stopped = "daily budget";
      return;
    }
    calls += CHECK_IN_CALLS;
    result.calls += CHECK_IN_CALLS;
    try {
      const find = await deps.findCheckIn(board);
      if (find.kind === "found" && (await deps.saveCheckIn(board.id, find.found))) result.checkIns += 1;
      if (find.kind === "no games") await deps.noteNoGames(board.id);
    } catch (err) {
      if (err instanceof OpenDotaBusy) {
        result.stopped = "rate limit";
        return;
      }
      deps.log(`Finding the game of check-in ${board.id} failed`, err);
    }
  }
}

async function findAndBuild(deps: JobDeps, maxCalls: number): Promise<RunResult> {
  const result: RunResult = {
    attached: 0,
    built: 0,
    checkIns: 0,
    removedFiles: 0,
    removedCheckIns: 0,
    calls: 0,
    stopped: null,
  };
  const take = async (n: number) => {
    if (result.calls + n > maxCalls) {
      result.stopped = "run cap";
      return false;
    }
    if (!(await deps.takeCalls(n))) {
      result.stopped = "daily budget";
      return false;
    }
    result.calls += n;
    return true;
  };

  for (const draft of await deps.claimDrafts()) {
    if (!(await take(findCalls(draft.account_ids.length)))) return result;
    try {
      const found = await deps.findMatch(draft);
      if (found && (await deps.attach(draft.draft_id, found))) result.attached += 1;
    } catch (err) {
      if (err instanceof OpenDotaBusy) return { ...result, stopped: "rate limit" };
      deps.log(`Finding the match of draft ${draft.draft_id} failed`, err);
    }
  }

  // Reports claimed but not built are left to their lease, which runs out in minutes.
  for (const report of await deps.claimReports()) {
    if (!(await take(REPORT_CALLS))) return result;
    try {
      await deps.save(report.draft_id, await deps.build(report));
      result.built += 1;
    } catch (err) {
      if (err instanceof OpenDotaBusy) return { ...result, stopped: "rate limit" };
      deps.log(`Saving the report of draft ${report.draft_id} failed`, err);
    }
  }
  return result;
}
