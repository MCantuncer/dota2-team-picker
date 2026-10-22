/**
 * Links a Steam account to a signed-in user who signed up by email, so their
 * rank and hero record count and they can sign in with Steam from then on.
 *
 *   POST /steam-link {"next": "/profile"}   (Authorization: Bearer <user's access token>)
 *        returns {"url": "<Steam sign-in page>"}; the website sends the browser there
 *   GET  /steam-link/callback               Steam sends the browser back here
 *
 * The callback carries a one-time request id instead of the user's token, so
 * the token never appears in a URL. Requests expire after 10 minutes.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { steamLoginUrl, verifySteamLogin } from "../_shared/steam.ts";
import { syncProfile } from "../_shared/sync.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SITE_URL = (Deno.env.get("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, "");
const FUNCTION_URL = (Deno.env.get("STEAM_LINK_URL") ?? `${SUPABASE_URL}/functions/v1/steam-link`).replace(/\/$/, "");
const REQUEST_TTL_MS = 10 * 60 * 1000;

const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);

  if (req.method === "POST") {
    const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
    const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!auth.user) return json({ error: "Not signed in" }, 401);
    const body = await req.json().catch(() => ({}));
    const { data: request, error } = await admin
      .from("steam_link_requests")
      .insert({ user_id: auth.user.id, next: safeNext(body.next) })
      .select("id")
      .single();
    if (error) {
      console.error("Saving link request failed", error);
      return json({ error: "Could not start linking, try again" }, 500);
    }
    return json({ url: steamLoginUrl(callbackFor(request.id), new URL(FUNCTION_URL).origin) });
  }

  if (!url.pathname.endsWith("/callback")) return json({ error: "Use POST" }, 405);

  const requestId = url.searchParams.get("request") ?? "";
  const { data: request } = await admin
    .from("steam_link_requests")
    .delete()
    .eq("id", requestId)
    .select("user_id, next, created_at")
    .maybeSingle();
  if (!request || Date.now() - Date.parse(request.created_at) > REQUEST_TTL_MS) return back("/profile", "expired");

  try {
    const steamId = await verifySteamLogin(url, callbackFor(requestId));
    if (!steamId) return back(request.next, "failed");

    const { data: owner } = await admin.from("profiles").select("id").eq("steam_id", steamId).maybeSingle();
    if (owner && owner.id !== request.user_id) return back(request.next, "taken");

    const { error } = await admin.from("profiles").update({ steam_id: steamId }).eq("id", request.user_id);
    if (error) throw error;
    await syncProfile(admin, request.user_id, steamId).catch((err) => console.error("Profile sync failed", err));
    return back(request.next, "linked");
  } catch (err) {
    console.error("Steam link failed", err);
    return back(request.next, "failed");
  }
});

function callbackFor(requestId: string): string {
  return `${FUNCTION_URL}/callback?${new URLSearchParams({ request: requestId })}`;
}

/** Back to the website with ?steam=linked|taken|failed|expired for the page to show. */
function back(next: string, result: string): Response {
  const target = new URL(SITE_URL + next);
  target.searchParams.set("steam", result);
  return Response.redirect(target.toString(), 302);
}

/** Only allow paths on our own site. */
function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/profile";
}
