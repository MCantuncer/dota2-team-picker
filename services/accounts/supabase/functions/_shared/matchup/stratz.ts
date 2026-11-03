/**
 * A small STRATZ GraphQL client for the edge functions. The token comes from the function's
 * secrets and never reaches the browser. Every call has a time limit, and any HTTP or
 * GraphQL error throws, so callers fail closed.
 */

const URL = "https://api.stratz.com/graphql";

/** Posts a query and returns its `data`. Throws on a timeout, an HTTP error or a GraphQL error. */
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
  // The shape is checked right below; anything else is an error.
  const body = (await res.json().catch(() => ({}))) as { data?: T | null; errors?: { message?: string }[] };
  if (!res.ok || body.errors?.length || !body.data) {
    const why = body.errors?.map((e) => e.message ?? "").join("; ") || `HTTP ${res.status}`;
    throw new Error(`STRATZ failed: ${why}`);
  }
  return body.data;
}
