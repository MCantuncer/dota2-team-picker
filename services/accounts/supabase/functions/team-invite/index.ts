/**
 * Invites a friend to a team by email.
 *
 *   POST /team-invite   {"teamId": "...", "email": "friend@example.com"}
 *   (Authorization: Bearer <captain's access token>)
 *
 * Saves the invite and emails a link to the website's join page. A friend
 * without an account gets Supabase's invite email, which signs them in on
 * first click; a friend who already has one gets a sign-in link. Either way
 * the link lands on /join/<invite id>, where they finish a short sign up and
 * accept. Sending again for the same email re-sends the link. Both emails name
 * the captain and the team (see supabase/templates).
 *
 * The team's owner (while their profiles.user_type is captain or admin) and
 * its co-captains may send, at most 30 emails a day each and one per address
 * per minute, so the sender can't be used to spam people.
 *
 * The website calls it with supabase.functions.invoke("team-invite", {body}).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { checkInviteLimits } from "../_shared/invite_limits.ts";

const SITE_URL = (Deno.env.get("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPTAIN_TYPES = ["captain", "admin"];
const DAY_MS = 24 * 60 * 60 * 1000;

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

  const team = await teamRunBy(teamId, auth.user.id);
  if (!team) return json({ error: "Team not found" }, 404);

  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [sentToday, lastSent] = await Promise.all([
    admin
      .from("team_invites")
      .select("id", { count: "exact", head: true })
      .eq("sent_by", auth.user.id)
      .gte("sent_at", since),
    admin.from("team_invites").select("sent_at").eq("team_id", team.id).eq("email", email).maybeSingle(),
  ]);
  const limits = checkInviteLimits({ sentToday, lastSent });
  if (!limits.ok) return json({ error: limits.message }, limits.status);

  const { data: invite, error } = await admin
    .from("team_invites")
    .upsert(
      { team_id: team.id, email, sent_at: new Date().toISOString(), sent_by: auth.user.id },
      { onConflict: "team_id,email" },
    )
    .select("id, email, created_at, sent_at, accepted_at")
    .single();
  if (error) {
    console.error("Saving invite failed", error);
    return json({ error: "Could not save the invite" }, 500);
  }

  const { data: sender } = await admin.from("profiles").select("display_name").eq("id", auth.user.id).single();
  const captain = sender?.display_name ?? "Your captain";
  const redirectTo = `${SITE_URL}/auth/confirm?next=${encodeURIComponent(`/join/${invite.id}`)}`;
  // The email templates read these from the user's metadata ({{ .Data.team_name }}), so both the
  // invite and the sign-in email say who invited them and to which team.
  const details = { team_name: team.name, captain_name: captain };
  const sent = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: details });
  if (sent.error?.code === "email_exists") {
    // Already has an account: send a sign-in link that lands on the same join page. The invite
    // details are set just for this email and removed after, so a later sign-in email stays plain.
    const { data: userId } = await admin.rpc("user_id_by_email", { address: email });
    if (userId) await setInviteDetails(userId, details);
    const otp = await admin.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    if (userId) await setInviteDetails(userId, { team_name: null, captain_name: null });
    if (otp.error) return failed(otp.error);
  } else if (sent.error) {
    return failed(sent.error);
  }
  return json(invite);
});

/**
 * The team, if this user may invite to it: its owner while they are still a captain or admin, or one
 * of its co-captains.
 */
async function teamRunBy(teamId: string, userId: string): Promise<{ id: string; name: string } | null> {
  if (!UUID.test(teamId)) return null;
  const { data: team } = await admin.from("teams").select("id, name, owner_id").eq("id", teamId).maybeSingle();
  if (!team) return null;
  if (team.owner_id === userId) {
    const { data: owner } = await admin.from("profiles").select("user_type").eq("id", userId).maybeSingle();
    return CAPTAIN_TYPES.includes(owner?.user_type) ? team : null;
  }
  const { data: member } = await admin
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  return member?.role === "co_captain" ? team : null;
}

/** Merges into user_metadata; null removes a key. A failure only makes the email less specific. */
async function setInviteDetails(userId: string, details: Record<string, string | null>) {
  const { error } = await admin.auth.admin.updateUserById(userId, { user_metadata: details });
  if (error) console.error("Updating invite details failed", error);
}

function failed(err: unknown): Response {
  console.error("Sending invite email failed", err);
  return json({ error: "The invite is saved, but the email could not be sent. Try again in a minute." }, 502);
}
