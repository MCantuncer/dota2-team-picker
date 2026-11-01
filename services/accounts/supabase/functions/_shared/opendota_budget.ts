/**
 * Takes OpenDota calls from the shared daily budget (see the take_opendota_calls database
 * function) before a function makes them. Fails closed: if the budget can't be checked, the
 * calls are refused.
 */

/** The part of a Supabase client this needs, so tests can pass a stand-in. */
export interface BudgetClient {
  rpc(
    fn: "take_opendota_calls",
    args: { wanted: number },
  ): PromiseLike<{ data: boolean | null; error: unknown }>;
}

export type BudgetResult = { ok: true } | { ok: false; status: 429 | 503; message: string };

export async function takeOpenDotaCalls(client: BudgetClient, wanted: number): Promise<BudgetResult> {
  const { data, error } = await client.rpc("take_opendota_calls", { wanted });
  if (error || data === null) {
    console.error("Checking the OpenDota budget failed", error ?? "no result");
    return { ok: false, status: 503, message: "Could not reach OpenDota right now. Try again in a minute." };
  }
  if (!data) {
    return { ok: false, status: 429, message: "Too many match lookups today. Try again tomorrow." };
  }
  return { ok: true };
}
