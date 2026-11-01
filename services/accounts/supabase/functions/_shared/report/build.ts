/**
 * One build-reports step for one claimed report: read the match, work out the facts, and say
 * what to save on the report row next. The network, Storage and database parts come in as
 * `deps`, so the rules are tested without them.
 *
 * - A parsed match: the raw match is saved for 90 days and the report is `ready`.
 * - Not parsed yet: a basic report is saved now and a parse is asked for, at most
 *   MAX_PARSE_REQUESTS times with growing gaps. Once those are used up and a day has
 *   passed, the report stays `basic` for good.
 * - An error: counted, retried after a growing gap, and `failed` after MAX_ERRORS in a row.
 * - OpenDota rate limiting (`OpenDotaBusy`) is not the report's fault: it is thrown on, so
 *   the run stops and the report is tried again next run.
 */
import { buildFacts, type Facts, FACTS_VERSION, type ItemCost } from "./facts.ts";
import type { ShownList } from "./fights.ts";
import { readOpenDotaMatch } from "./match.ts";

export const MAX_PARSE_REQUESTS = 5;
export const MAX_ERRORS = 5;
/** First retry gap; each later one doubles: 10, 20, 40, 80, 160 minutes. */
const FIRST_GAP_MS = 10 * 60 * 1000;
/** How long after the match was found the job keeps waiting for a parse. */
export const PARSE_WAIT_MS = 24 * 60 * 60 * 1000;
const ERROR_MAX_CHARS = 500;

export const retryGapMs = (tries: number) => FIRST_GAP_MS * 2 ** Math.max(0, tries);

/** OpenDota said to slow down (HTTP 429): stop this run, nothing is wrong with the report. */
export class OpenDotaBusy extends Error {
  constructor() {
    super("OpenDota rate limit");
  }
}

/** A report the job claimed, as `claim_match_reports` returns it. */
export interface ClaimedReport {
  draft_id: string;
  match_id: number;
  /** The party's result, saved when the match was attached; tells which side was ours. */
  won: boolean | null;
  parse_requests: number;
  parse_requested_at: string | null;
  attempts: number;
  created_at: string;
}

export interface BuildDeps {
  /** The raw `GET /matches/{id}` response, or null when OpenDota doesn't know the match. */
  fetchMatch: (matchId: number) => Promise<unknown | null>;
  requestParse: (matchId: number) => Promise<void>;
  /** Keeps the raw parsed match (gzip in Storage, listed in match_files). */
  saveRawMatch: (matchId: number, raw: unknown) => Promise<void>;
  /** Each of our picks with the list its player was shown (`report_draft_lists`). */
  draftLists: (draftId: string) => Promise<ShownList[]>;
  /** Item key to id and cost, from the hero-data snapshot. */
  items: Record<string, ItemCost>;
  now: Date;
}

/** The columns to update on the report row; the lease is always released. */
export interface ReportUpdate {
  status: "waiting_parse" | "ready" | "basic" | "failed";
  facts?: Facts;
  facts_version?: number;
  game_mode?: number;
  lobby_type?: number;
  parse_requests: number;
  parse_requested_at: string | null;
  attempts: number;
  error: string | null;
  next_try_at: string;
  lease_until: null;
  updated_at: string;
}

export async function buildReport(report: ClaimedReport, deps: BuildDeps): Promise<ReportUpdate> {
  const now = deps.now.getTime();
  const at = (ms: number) => new Date(ms).toISOString();
  const keep = {
    parse_requests: report.parse_requests,
    parse_requested_at: report.parse_requested_at,
    lease_until: null,
    updated_at: at(now),
  };

  try {
    if (report.won === null) throw new Error("The draft has no result saved");
    const raw = await deps.fetchMatch(report.match_id);
    if (raw === null) throw new Error("OpenDota doesn't have the match yet");
    const match = readOpenDotaMatch(raw);
    const isRadiant = report.won === match.radiantWin;
    const facts = buildFacts(match, isRadiant, deps.items, await deps.draftLists(report.draft_id));
    const built = {
      ...keep,
      facts,
      facts_version: FACTS_VERSION,
      game_mode: match.gameMode,
      lobby_type: match.lobbyType,
      attempts: 0,
      error: null,
    };

    if (match.isParsed) {
      await deps.saveRawMatch(report.match_id, raw);
      return { ...built, status: "ready", next_try_at: at(now) };
    }

    if (report.parse_requests >= MAX_PARSE_REQUESTS) {
      const giveUpAt = Date.parse(report.created_at) + PARSE_WAIT_MS;
      return now >= giveUpAt
        ? { ...built, status: "basic", next_try_at: at(now) }
        : { ...built, status: "waiting_parse", next_try_at: at(giveUpAt) };
    }

    let requests = report.parse_requests;
    let requestedAt = report.parse_requested_at === null ? null : Date.parse(report.parse_requested_at);
    if (requestedAt === null || now - requestedAt >= retryGapMs(requests - 1)) {
      await deps.requestParse(report.match_id);
      requests += 1;
      requestedAt = now;
    }
    return {
      ...built,
      status: "waiting_parse",
      parse_requests: requests,
      parse_requested_at: at(requestedAt),
      next_try_at: at(requestedAt + retryGapMs(requests - 1)),
    };
  } catch (err) {
    if (err instanceof OpenDotaBusy) throw err;
    return failure(report, err, keep, now);
  }
}

function failure(
  report: ClaimedReport,
  err: unknown,
  keep: Pick<ReportUpdate, "parse_requests" | "parse_requested_at" | "lease_until" | "updated_at">,
  now: number,
): ReportUpdate {
  const attempts = report.attempts + 1;
  const message = err instanceof Error ? err.message : String(err);
  return {
    ...keep,
    status: attempts >= MAX_ERRORS ? "failed" : "waiting_parse",
    attempts,
    error: message.slice(0, ERROR_MAX_CHARS),
    next_try_at: new Date(now + retryGapMs(attempts - 1)).toISOString(),
  };
}
