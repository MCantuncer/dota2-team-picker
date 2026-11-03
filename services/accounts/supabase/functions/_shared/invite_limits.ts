/** Invite emails one sender may send in a rolling day. The database (claim_invite_send) enforces it. */
export const DAILY_INVITE_LIMIT = 30;
/** Invite emails an account younger than a day may send. */
export const NEW_ACCOUNT_INVITE_LIMIT = 5;
/** Invite emails one address may get in a rolling day, from all Stacks together. */
export const ADDRESS_INVITE_LIMIT = 3;

/** What claim_invite_send returned. A Supabase error is anything non-null in `error`. */
export interface ClaimResult {
  data: unknown;
  error: unknown;
}

export type LimitResult = { ok: true } | { ok: false; status: 429 | 503; message: string };

const MESSAGES: Record<string, string> = {
  resend_wait: "Invite just sent. Wait a minute before sending it again.",
  sender_daily: `You can send ${DAILY_INVITE_LIMIT} invites a day. Try again tomorrow.`,
  new_account: `New accounts can send ${NEW_ACCOUNT_INVITE_LIMIT} invites on their first day. Try again tomorrow.`,
  address_daily: "This address got enough invites today. Try again tomorrow.",
  site_daily: "We're sending too many invites today. Try again tomorrow.",
};

/**
 * Decides whether the invite email may go out, from claim_invite_send's answer ('ok' or the limit
 * hit). Fails closed: if the check errored or answered something unknown, the invite is refused.
 */
export function checkInviteLimits({ data, error }: ClaimResult): LimitResult {
  if (!error && data === "ok") return { ok: true };
  const message = typeof data === "string" ? MESSAGES[data] : undefined;
  if (error || !message) {
    console.error("Checking invite limits failed", error ?? `unexpected answer ${String(data)}`);
    return { ok: false, status: 503, message: "Could not send the invite right now. Try again in a minute." };
  }
  return { ok: false, status: 429, message };
}
