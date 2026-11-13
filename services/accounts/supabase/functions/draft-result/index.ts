/**
 * Finds the match a party draft turned into and records whether the party won.
 *
 *   POST /draft-result   (Authorization: Bearer <user's access token>)
 *   body: { draftId: string, matchId?: number }
 *
 * Without a match ID it looks through the recent matches of the party's Steam players on
 * OpenDota. With one (for players without Steam or with a hidden profile) it checks that the
 * draft's heroes played on one side of that match. A found match is confirmed the same way
 * before it is saved, with who played which hero, and its post-game report is queued. Either
 * way it also asks OpenDota to parse the replay. Looks at most once every 20 seconds per draft.
 * Returns { matchId, won } or { matchId: null } when no match was found yet.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { attachMatch, findCalls, findDraftMatch, type FoundMatch } from "../_shared/attach.ts";
import { fetchMatch, fetchRecentMatches, readMatch, requestParse } from "../_shared/match.ts";
import { takeOpenDotaCalls } from "../_shared/opendota_budget.ts";
import { steamIdToAccountId } from "../_shared/steam.ts";

const MIN_INTERVAL_MS = 20 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json({ error: "Not signed in" }, 401);

  const body = await req.json().catch(() => null);
  const draftId = body?.draftId;
  const matchId = body?.matchId;
  if (typeof draftId !== "string" || !UUID.test(draftId)) return json({ error: "Missing draft" }, 400);
  if (matchId !== undefined && !(Number.isSafeInteger(matchId) && matchId > 0)) {
    return json({ error: "A match ID is a number, like 8012345678" }, 400);
  }

  // Read the draft as the user, so the party's own access rules decide what they may see.
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [{ data: draft, error: draftError }, { data: state, error: stateError }] = await Promise.all([
    asUser.from("party_drafts").select("party_id, created_at, match_id, won, result_checked_at").eq("id", draftId)
      .maybeSingle(),
    asUser.rpc("draft_state", { draft: draftId }),
  ]);
  if (draftError || stateError) {
    console.error("Draft read failed", draftError ?? stateError);
    return json({ error: "Could not read the draft, try again" }, 500);
  }
  if (!draft) return json({ error: "Draft not found" }, 404);
  if (draft.match_id && matchId === undefined) return json({ matchId: draft.match_id, won: draft.won });
  if (draft.result_checked_at && Date.now() - Date.parse(draft.result_checked_at) < MIN_INTERVAL_MS) {
    return json({ error: "Checked a moment ago, try again in a few seconds" }, 429);
  }

  const allies: number[] = (state ?? []).filter((s: { kind: string }) => s.kind === "ally").map((
    s: { hero_id: number },
  ) => s.hero_id);
  if (!allies.length) return json({ error: "Enter your team's heroes first" }, 400);

  const { error: markError } = await admin
    .from("party_drafts")
    .update({ result_checked_at: new Date().toISOString() })
    .eq("id", draftId);
  if (markError) {
    console.error("Draft update failed", markError);
    return json({ error: "Could not save the result, try again" }, 500);
  }

  let found: FoundMatch | null = null;
  try {
    if (matchId !== undefined) {
      // The match, then the parse request.
      const budget = await takeOpenDotaCalls(admin, 2);
      if (!budget.ok) return json({ error: budget.message }, budget.status);
      const match = await fetchMatch(matchId);
      if (!match) return json({ error: "OpenDota doesn't know that match yet. Try again in a few minutes." }, 404);
      const side = readMatch(match, allies);
      if (!side) return json({ error: "Your team's heroes aren't in that match" }, 422);
      found = { match, side };
    } else {
      const accountIds = await draftAccountIds(draftId, draft.party_id);
      if (!accountIds.length) return json({ matchId: null });
      // Each player's recent matches and the match itself, then the parse request.
      const budget = await takeOpenDotaCalls(admin, findCalls(accountIds.length) + 1);
      if (!budget.ok) return json({ error: budget.message }, budget.status);
      found = await findDraftMatch({ fetchRecentMatches, fetchMatch }, accountIds, allies, new Date(draft.created_at));
    }
  } catch (err) {
    console.error("Match lookup failed", err);
    return json({ error: "Could not reach OpenDota, try again later" }, 502);
  }
  if (!found) return json({ matchId: null });

  await requestParse(found.side.matchId);
  try {
    if (!(await attachMatch(admin, draftId, found))) {
      // Someone else's lookup attached a match a moment ago: show that one.
      const { data: now, error } = await admin.from("party_drafts").select("match_id, won").eq("id", draftId).single();
      if (error) throw error;
      return json({ matchId: now.match_id, won: now.won });
    }
  } catch (err) {
    console.error("Saving the match failed", err);
    return json({ error: "Could not save the result, try again" }, 500);
  }
  return json({ matchId: found.side.matchId, won: found.side.won });
});

/**
 * The Dota accounts to search: the draft's saved players and seated players, or while it
 * is open, the party's members and seated players with Steam linked.
 */
async function draftAccountIds(draftId: string, partyId: string): Promise<number[]> {
  const [players, seated] = await Promise.all([
    admin.from("draft_players").select("account_id").eq("draft_id", draftId).not("account_id", "is", null),
    admin.from("draft_search_accounts").select("account_id").eq("draft_id", draftId),
  ]);
  if (players.error) throw players.error;
  if (seated.error) throw seated.error;
  if (players.data.length || seated.data.length) {
    const saved = [
      ...players.data.flatMap((p) => (p.account_id ? [p.account_id] : [])),
      ...seated.data.map((s) => s.account_id),
    ];
    return [...new Set(saved)];
  }
  const [members, seats] = await Promise.all([
    admin.from("party_members").select("user_id").eq("party_id", partyId),
    admin.from("party_seats").select("user_id").eq("party_id", partyId),
  ]);
  if (members.error) throw members.error;
  if (seats.error) throw seats.error;
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("steam_id")
    .in("id", [...members.data, ...seats.data].map((m) => m.user_id))
    .not("steam_id", "is", null);
  if (profileError) throw profileError;
  return profiles.flatMap((p) => (p.steam_id ? [steamIdToAccountId(p.steam_id)] : []));
}
