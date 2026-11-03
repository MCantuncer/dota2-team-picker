/**
 * The build-reports job, called every 10 minutes by pg_cron (see run_build_reports).
 *
 *   POST /build-reports   (X-Job-Secret: <the shared secret in Vault and BUILD_REPORTS_SECRET>)
 *
 * Finds the matches of ended drafts nobody looked up, then builds the reports that are due
 * (see _shared/report/job.ts and build.ts), and deletes saved matches older than 90 days or
 * without a report. Returns what the run did.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/cors.ts";
import { attachMatch, findDraftMatch } from "../_shared/attach.ts";
import { fetchMatch, fetchRecentMatches, requestParse } from "../_shared/match.ts";
import { sameSecret } from "../_shared/job_secret.ts";
import { takeOpenDotaCalls } from "../_shared/opendota_budget.ts";
import { buildReport, type ClaimedReport, OpenDotaBusy } from "../_shared/report/build.ts";
import type { ItemCost } from "../_shared/report/facts.ts";
import { runJob, type UnattachedDraft } from "../_shared/report/job.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const SNAPSHOT_URL = `${url}/storage/v1/object/public/hero-data/snapshot.json`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const secret = Deno.env.get("BUILD_REPORTS_SECRET");
  if (!secret) {
    console.error("BUILD_REPORTS_SECRET is not set");
    return json({ error: "Not set up" }, 503);
  }
  if (!(await sameSecret(req.headers.get("X-Job-Secret") ?? "", secret))) return json({ error: "Forbidden" }, 401);

  let items: Record<string, ItemCost> | null = null;
  const result = await runJob({
    takeCalls: async (n) => (await takeOpenDotaCalls(admin, n)).ok,
    claimDrafts: async () => {
      const { data, error } = await admin.rpc("claim_unattached_drafts");
      if (error) throw error;
      return data as UnattachedDraft[];
    },
    findMatch: (draft) =>
      findDraftMatch(
        { fetchRecentMatches: (id) => fetchRecentMatches(id, openDota), fetchMatch: (id) => fetchMatch(id, openDota) },
        draft.account_ids,
        draft.allies,
        new Date(draft.created_at),
      ),
    attach: (draftId, found) => attachMatch(admin, draftId, found),
    claimReports: async () => {
      const { data, error } = await admin.rpc("claim_match_reports");
      if (error) throw error;
      return data as ClaimedReport[];
    },
    build: async (report) =>
      buildReport(report, {
        fetchMatch: (id) => fetchMatch(id, openDota),
        requestParse: (id) => requestParse(id, openDota),
        saveRawMatch,
        draftLists,
        items: items ??= await loadItems(),
        now: new Date(),
      }),
    save: async (draftId, update) => {
      const { error } = await admin.from("match_reports").update(update).eq("draft_id", draftId);
      if (error) throw error;
    },
    cleanFiles,
    log: (message, err) => console.error(message, err),
  }).catch((err) => {
    console.error("The report run failed", err);
    return null;
  });
  return result ? json(result) : json({ error: "The run failed" }, 500);
});

/** fetch for OpenDota: HTTP 429 stops the run instead of counting against a report. */
async function openDota(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 429) {
    await res.body?.cancel();
    throw new OpenDotaBusy();
  }
  return res;
}

/** Saves the raw parsed match gzipped in the private match-data bucket and lists it. */
async function saveRawMatch(matchId: number, raw: unknown): Promise<void> {
  const body = new Blob([JSON.stringify(raw)]).stream().pipeThrough(new CompressionStream("gzip"));
  const gz = new Uint8Array(await new Response(body).arrayBuffer());
  const { error } = await admin.storage.from("match-data").upload(`${matchId}.json.gz`, gz, {
    contentType: "application/gzip",
    upsert: true,
  });
  if (error) throw error;
  const { error: listError } = await admin.from("match_files").upsert({
    match_id: matchId,
    size_bytes: gz.byteLength,
    saved_at: new Date().toISOString(),
  });
  if (listError) throw listError;
}

/** Deletes saved matches older than 90 days or without a report, then drops them from the list. */
async function cleanFiles(): Promise<number> {
  const { data, error } = await admin.rpc("stale_match_files");
  if (error) throw error;
  const ids = (data as { match_id: number }[]).map((row) => row.match_id);
  if (!ids.length) return 0;
  const { error: removeError } = await admin.storage.from("match-data").remove(ids.map((id) => `${id}.json.gz`));
  if (removeError) throw removeError;
  const { data: forgotten, error: forgetError } = await admin.rpc("forget_match_files", { matches: ids });
  if (forgetError) throw forgetError;
  return forgotten as number;
}

async function draftLists(draftId: string) {
  const { data, error } = await admin.rpc("report_draft_lists", { draft: draftId });
  if (error) throw error;
  return (data as { hero_id: number; shown: number[] }[]).map((row) => ({ heroId: row.hero_id, shown: row.shown }));
}

/** Item key to id and cost from the hero-data snapshot. Without it, key items are left out. */
async function loadItems(): Promise<Record<string, ItemCost>> {
  try {
    const res = await fetch(SNAPSHOT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snapshot = await res.json() as { items?: Record<string, { key: string; cost: number }> };
    return Object.fromEntries(
      Object.entries(snapshot.items ?? {}).map(([id, item]) => [item.key, { id: Number(id), cost: item.cost }]),
    );
  } catch (err) {
    console.error("Loading item costs failed; reports leave key items out", err);
    return {};
  }
}
