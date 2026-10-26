/**
 * A small client for the free OpenDota API, shared by the data scripts. It keeps
 * requests under the per-minute limit, retries server errors and rate limits,
 * and tracks how many requests are left today.
 */
const API = "https://api.opendota.com/api";
/** The free API allows 60 requests a minute; stay well below it. */
const REQUEST_GAP_MS = 1500;
/** How long to wait after a 429 when the API does not say. */
const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_ATTEMPTS = 5;

let lastRequest = 0;
/** Requests left today, from the API's x-rate-limit-remaining-day header. */
let remainingToday = Infinity;

/** Requests the API says are left today (Infinity until the first answer says). */
export function requestsLeftToday(): number {
  return remainingToday;
}

/** GETs an OpenDota path (`/heroStats`) and returns the parsed JSON. Throws after the last retry. */
export async function getOpenDota<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const res = await fetch(API + path).catch((err: unknown) => err as Error);
    const left = res instanceof Error ? null : res.headers.get("x-rate-limit-remaining-day");
    if (left !== null && Number.isFinite(Number(left))) remainingToday = Number(left);
    if (!(res instanceof Error) && res.ok) return (await res.json()) as T;
    const status = res instanceof Error ? res.message : `HTTP ${res.status}`;
    const limited = !(res instanceof Error) && res.status === 429;
    if (attempt >= MAX_ATTEMPTS - 1 || (!(res instanceof Error) && res.status < 500 && !limited)) {
      throw new Error(`GET ${path} failed: ${status}`);
    }
    const backoff = limited ? retryAfterMs(res) : 2000 * 2 ** attempt;
    console.warn(`GET ${path} failed (${status}), retrying in ${Math.round(backoff / 1000)}s`);
    await sleep(backoff);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_WAIT_MS;
}
