/**
 * Invites a friend to the captain's team by email.
 *
 *   POST /team-invite   {"teamId": "...", "email": "friend@example.com"}
 *   (Authorization: Bearer <captain's access token>)
 *
 * Saves the invite and emails a link to the website's join page. A friend
 * without an account gets Supabase's invite email, which signs them in on
 * first click; a friend who already has one gets a sign-in link. Either way
 * the link lands on /join/<invite id>, where they finish a short sign up and
 * accept. Sending again for the same email re-sends the link.
 *
 * The website calls it with supabase.functions.invoke("team-invite", {body}).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SITE_URL = (Deno.env.get("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json({ error: "Not signed in" }, 401);

  const body = await req.json().catch(() => ({}));
  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return json({ error: "That email address doesn't look right" }, 400);

  const { data: team } = await admin
    .from("teams")
    .select("id, name")
    .eq("id", teamId)
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (!team) return json({ error: "Team not found" }, 404);

  const { data: invite, error } = await admin
    .from("team_invites")
    .upsert({ team_id: team.id, email }, { onConflict: "team_id,email" })
    .select("id, email, created_at, accepted_at")
    .single();
  if (error) {
    console.error("Saving invite failed", error);
    return json({ error: "Could not save the invite" }, 500);
  }

  const { data: owner } = await admin.from("profiles").select("display_name").eq("id", auth.user.id).single();
  const captain = owner?.display_name ?? "Your captain";
  const redirectTo = `${SITE_URL}/auth/confirm?next=${encodeURIComponent(`/join/${invite.id}`)}`;
  const sent = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { team_name: team.name, captain_name: captain },
  });
  if (sent.error?.code === "email_exists") {
    // Already has an account: send a sign-in link that lands on the same join page.
    const otp = await admin.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
    if (otp.error) return failed(otp.error);
  } else if (sent.error) {
    return failed(sent.error);
  }
  return json(invite);
});

function failed(err: unknown): Response {
  console.error("Sending invite email failed", err);
  return json({ error: "The invite is saved, but the email could not be sent. Try again in a minute." }, 502);
}
