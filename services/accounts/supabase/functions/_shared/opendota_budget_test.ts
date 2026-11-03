import { assertEquals } from "jsr:@std/assert@1";
import { type BudgetClient, takeOpenDotaCalls } from "./opendota_budget.ts";

const client = (data: boolean | null, error: unknown = null): BudgetClient & { asked: number[] } => {
  const asked: number[] = [];
  return { asked, rpc: (_fn, args) => (asked.push(args.wanted), Promise.resolve({ data, error })) };
};

Deno.test("allows calls that fit in today's budget", async () => {
  const c = client(true);
  assertEquals(await takeOpenDotaCalls(c, 3), { ok: true });
  assertEquals(c.asked, [3]);
});

Deno.test("refuses calls once the budget is spent", async () => {
  const result = await takeOpenDotaCalls(client(false), 1);
  assertEquals(result.ok ? null : result.status, 429);
});

Deno.test("fails closed when the budget can't be read", async () => {
  for (const c of [client(null, { message: "connection reset" }), client(null)]) {
    const result = await takeOpenDotaCalls(c, 1);
    assertEquals(result.ok ? null : result.status, 503);
  }
});

Deno.test("a caller with its own share passes its name and cap", async () => {
  const args: unknown[] = [];
  const c: BudgetClient = { rpc: (_fn, a) => (args.push(a), Promise.resolve({ data: true, error: null })) };
  assertEquals(await takeOpenDotaCalls(c, 2, { caller: "trends", dailyCap: 300 }), { ok: true });
  assertEquals(args, [{ wanted: 2, caller_name: "trends", caller_cap: 300 }]);
});
