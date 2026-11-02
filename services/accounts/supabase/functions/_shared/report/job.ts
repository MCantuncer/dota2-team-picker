/**
 * One run of the build-reports job: first look for the matches of drafts nobody looked up,
 * then build the reports that are due, then delete saved matches older than 90 days or
 * without a report. Every OpenDota call is taken from the daily budget
 * first, and a run makes at most MAX_RUN_CALLS of them. The run stops when the budget is
 * used up or OpenDota rate limits; what was left is picked up next run.
 */
import { findCalls, type FoundMatch } from "../attach.ts";
import { type ClaimedReport, OpenDotaBusy, type ReportUpdate } from "./build.ts";

export const MAX_RUN_CALLS = 30;
/** A report fetches the match and may ask for a parse. */
const REPORT_CALLS = 2;

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
  /** Deletes stale saved matches; returns how many. */
  cleanFiles: () => Promise<number>;
  log: (message: string, err?: unknown) => void;
}

export interface RunResult {
  attached: number;
  built: number;
  removedFiles: number;
  calls: number;
  /** Why the run ended early, if it did. */
  stopped: "run cap" | "daily budget" | "rate limit" | null;
}

export async function runJob(deps: JobDeps, maxCalls = MAX_RUN_CALLS): Promise<RunResult> {
  const result = await findAndBuild(deps, maxCalls);
  // No OpenDota calls, so this runs even when the budget or a rate limit stopped the rest.
  try {
    result.removedFiles = await deps.cleanFiles();
  } catch (err) {
    deps.log("Deleting old saved matches failed", err);
  }
  return result;
}

async function findAndBuild(deps: JobDeps, maxCalls: number): Promise<RunResult> {
  const result: RunResult = { attached: 0, built: 0, removedFiles: 0, calls: 0, stopped: null };
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
