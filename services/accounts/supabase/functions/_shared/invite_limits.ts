/** Invite emails one sender may send in a rolling day. */
export const DAILY_INVITE_LIMIT = 30;
/** Wait before the same address can be sent the same team's invite again. */
export const RESEND_AFTER_MS = 60 * 1000;

/** What the two limit queries returned. A Supabase error is anything non-null in `error`. */
export interface LimitQueries {
  sentToday: { count: number | null; error: unknown };
  lastSent: { data: { sent_at: string } | null; error: unknown };
}

export type LimitResult = { ok: true } | { ok: false; status: 429 | 503; message: string };

/**
 * Decides whether another invite may go out. Fails closed: if either query failed, the
 * limit can't be checked, so the invite is refused instead of sent unchecked.
 */
export function checkInviteLimits({ sentToday, lastSent }: LimitQueries, now = Date.now()): LimitResult {
  if (sentToday.error || lastSent.error || sentToday.count === null) {
    console.error("Checking invite limits failed", sentToday.error ?? lastSent.error ?? "no count returned");
    return { ok: false, status: 503, message: "Could not send the invite right now. Try again in a minute." };
  }
  if (sentToday.count >= DAILY_INVITE_LIMIT) {
    return { ok: false, status: 429, message: `You can send ${DAILY_INVITE_LIMIT} invites a day. Try again tomorrow.` };
  }
  if (lastSent.data && now - Date.parse(lastSent.data.sent_at) < RESEND_AFTER_MS) {
    return { ok: false, status: 429, message: "Invite just sent. Wait a minute before sending it again." };
  }
  return { ok: true };
}
