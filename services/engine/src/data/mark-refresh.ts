/**
 * Tells the matchup lookups that this refresh is using the STRATZ token, or that it is done:
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run mark-refresh -- start|end
 *
 * STRATZ lets a token be used from 2 addresses per 15 minutes. The lookups (edge functions) share the
 * token, so they leave STRATZ alone while the refresh runs and for 15 minutes after. On start this
 * waits until 15 minutes after the last lookup call, so the refresh's own calls aren't refused.
 */
import { createClient } from "@supabase/supabase-js";

/** The longest wait on start, whatever the database answers. */
const MAX_WAIT_MS = 15 * 60 * 1000;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** How long to wait before the first STRATZ call, from the time the database answered. */
export function waitBeforeCalls(startAt: unknown, now: number): number {
  const at = typeof startAt === "string" ? Date.parse(startAt) : NaN;
  return Number.isFinite(at) ? Math.min(Math.max(at - now, 0), MAX_WAIT_MS) : 0;
}

async function main() {
  const which = process.argv[2];
  if (which !== "start" && which !== "end") throw new Error("Say start or end");
  const supabase = createClient(
    env("SUPABASE_URL"),
    env("SUPABASE_SECRET_KEY"),
    {
      auth: { persistSession: false },
    },
  );
  const { data, error } = await supabase.rpc("mark_stratz_refresh", {
    running: which === "start",
  });
  if (error)
    throw new Error(`Marking the refresh ${which} failed: ${error.message}`);
  if (which === "end") {
    console.log("Marked the STRATZ refresh finished");
    return;
  }
  const waitMs = waitBeforeCalls(data, Date.now());
  console.log(
    `Marked the STRATZ refresh started; waiting ${Math.round(waitMs / 1000)} s for the last lookup to age out`,
  );
  await new Promise((done) => setTimeout(done, waitMs));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
