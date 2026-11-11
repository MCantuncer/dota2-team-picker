/**
 * Sign in a phone from the PC with a QR code.
 *
 *   POST /phone-sign-in   form field code=<code from create_phone_sign_in>
 *
 * The PC's Draft page shows a QR code of the website's /follow page with a code that works once, for 60 seconds.
 * The phone's /follow page posts it here with one tap (a POST, so link previews and prefetching can't use it up,
 * and the code stays out of URLs and logs). We use the code up, then sign the phone in to the same account the
 * way Steam sign-in does: a one-time token that the website's /auth/confirm page swaps for a session.
 *
 * Accepted risk: another site could post its own fresh code here and sign a visitor in to the wrong account. The
 * code lasts 60 seconds and the page shows whose account it is, so this is not worth a CSRF token.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { readCode } from "../_shared/phone_sign_in.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** The website's address. Users are only ever sent back there. */
const SITE_URL = (Deno.env.get("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, "");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  const code = await readCode(req);
  if (!code) return failed("No code in the request");

  try {
    const { data: userId, error } = await admin.rpc("redeem_phone_sign_in", { code });
    if (error) throw error;
    if (!userId) return failed("Unknown, used or expired code");

    const { data: found, error: userError } = await admin.auth.admin.getUserById(userId);
    if (userError) throw userError;
    const email = found.user.email;
    if (!email) return failed("The account has no sign-in address");

    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;

    const confirm = new URL(`${SITE_URL}/auth/confirm`);
    confirm.searchParams.set("token_hash", link.data.properties.hashed_token);
    confirm.searchParams.set("type", "email");
    confirm.searchParams.set("next", "/draft");
    return Response.redirect(confirm.toString(), 303);
  } catch (err) {
    console.error("Phone sign-in failed", err);
    return failed("Phone sign-in failed");
  }
});

function failed(reason: string): Response {
  console.warn(reason);
  return Response.redirect(`${SITE_URL}/login?error=phone`, 303);
}
