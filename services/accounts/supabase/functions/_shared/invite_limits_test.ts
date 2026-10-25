import { assertEquals } from "jsr:@std/assert@1";
import { checkInviteLimits, DAILY_INVITE_LIMIT, type LimitQueries } from "./invite_limits.ts";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const ok = (count: number, sentAt: string | null = null): LimitQueries => ({
  sentToday: { count, error: null },
  lastSent: { data: sentAt ? { sent_at: sentAt } : null, error: null },
});

Deno.test("allows an invite under both limits", () => {
  assertEquals(checkInviteLimits(ok(0), NOW), { ok: true });
  assertEquals(checkInviteLimits(ok(DAILY_INVITE_LIMIT - 1, "2026-10-24T11:58:00Z"), NOW), { ok: true });
});

Deno.test("refuses once the daily limit is reached", () => {
  const result = checkInviteLimits(ok(DAILY_INVITE_LIMIT), NOW);
  assertEquals(result.ok ? null : result.status, 429);
});

Deno.test("refuses a resend to the same address within a minute", () => {
  const result = checkInviteLimits(ok(1, "2026-10-24T11:59:30Z"), NOW);
  assertEquals(result.ok ? null : result.status, 429);
});

Deno.test("fails closed when a limit query errors", () => {
  const error = { message: "connection reset" };
  const countFailed = { ...ok(0), sentToday: { count: null, error } };
  const lastFailed = { ...ok(0), lastSent: { data: null, error } };
  for (const queries of [countFailed, lastFailed, { ...ok(0), sentToday: { count: null, error: null } }]) {
    const result = checkInviteLimits(queries, NOW);
    assertEquals(result.ok ? null : result.status, 503);
  }
});
