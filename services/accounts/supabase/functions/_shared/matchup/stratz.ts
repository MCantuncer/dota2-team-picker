/**
 * A small STRATZ GraphQL client for the edge functions. The token comes from the function's
 * secrets and never reaches the browser. Every call has a time limit, and any HTTP or
 * GraphQL error throws, so callers fail closed.
 */

const URL = "https://api.stratz.com/graphql";

/** How long to wait after a refusal that gives no Retry-After: STRATZ counts a token's addresses over 15 minutes. */
export const BUSY_WAIT_MS = 15 * 60 * 1000;

/** The longest wait taken from Retry-After. */
const MAX_WAIT_MS = 60 * 60 * 1000;

/** STRATZ refused the call (HTTP 429): too many calls, or the token was used from too many addresses. */
export class StratzBusy extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`STRATZ is busy, try again in ${Math.round(retryAfterMs / 1000)} s`);
  }
}

/**
 * Posts a query and returns its `data`. Throws StratzBusy on a 429, with the wait from Retry-After when
 * STRATZ gives one, and an Error on a timeout, any other HTTP error or a GraphQL error.
 */
export async function postStratz<T>(
  token: string,
  query: string,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchFn(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // STRATZ asks API clients to send this user agent.
      "User-Agent": "STRATZ_API",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    throw new StratzBusy(
      Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_WAIT_MS) : BUSY_WAIT_MS,
    );
  }
  // The shape is checked right below; anything else is an error.
  const body = (await res.json().catch(() => ({}))) as { data?: T | null; errors?: { message?: string }[] };
  if (!res.ok || body.errors?.length || !body.data) {
    const why = body.errors?.map((e) => e.message ?? "").join("; ") || `HTTP ${res.status}`;
    throw new Error(`STRATZ failed: ${why}`);
  }
  return body.data;
}
