import { assertEquals } from "jsr:@std/assert@1";
import { checkInviteLimits } from "./invite_limits.ts";

Deno.test("allows an invite when the database says ok", () => {
  assertEquals(checkInviteLimits({ data: "ok", error: null }), { ok: true });
});

Deno.test("refuses with 429 and a plain message for each limit", () => {
  for (const code of ["resend_wait", "sender_daily", "new_account", "address_daily", "site_daily"]) {
    const result = checkInviteLimits({ data: code, error: null });
    assertEquals(result.ok ? null : result.status, 429, code);
    assertEquals(result.ok ? "" : result.message.length > 0, true, code);
  }
});

Deno.test("fails closed when the check errors or answers something unknown", () => {
  const error = { message: "connection reset" };
  for (
    const claim of [{ data: null, error }, { data: "ok", error }, { data: "maybe", error: null }, {
      data: 1,
      error: null,
    }]
  ) {
    const result = checkInviteLimits(claim);
    assertEquals(result.ok ? null : result.status, 503);
  }
});
