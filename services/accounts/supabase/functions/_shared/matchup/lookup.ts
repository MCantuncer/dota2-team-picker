/**
 * The live matchup lookup behind the matchup-builds function: for each of our heroes against
 * each enemy, the cached high-rank games when fresh, else fetched from STRATZ within a time
 * budget and cached. Every limit fails closed: when a limit says no or STRATZ fails, the
 * answer has what the cache has, the rest is listed as pending, and the card keeps showing
 * the weekly general build.
 *
 * STRATZ lets a token be used from 2 addresses per 15 minutes, and the hero data refresh uses the same
 * token. So while the refresh runs, for 15 minutes after, and after a 429 any lookup got, lookups leave
 * STRATZ alone and answer "stratz-busy" with a time to ask again (the database decides when, see
 * 20261104010000_stratz_refresh.sql).
 */
import {
  guideListQuery,
  guideMatchIds,
  MATCHES_PER_QUERY,
  matchesQuery,
  type MatchupGame,
  queriesNeeded,
  type Slice,
  sliceGames,
  toMatchupGame,
} from "./queries.ts";
import { StratzBusy } from "./stratz.ts";

/** Cache rows younger than this are used without asking STRATZ. */
export const FRESH_DAYS = 7;
/** The whole STRATZ part of a lookup must finish within this, so the card isn't kept waiting. */
export const BUDGET_MS = 8000;
/** Match queries in flight at once. */
const CONCURRENCY = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
export interface CachedSlice extends Slice {
  games: MatchupGame[];
  fetchedAt: string;
}

/** Everything the lookup talks to, so tests can pass stand-ins. Each throws on an error. */
export interface LookupDeps {
  /** When lookups may use STRATZ again (ISO time), or null when they may now. */
  freeAt(): Promise<string | null>;
  /** Holds every lookup back until this time, after a 429. */
  noteBusy(until: number): Promise<void>;
  /** Cache rows for these heroes and enemies on this game version (any age the table keeps). */
  readCache(heroes: number[], enemies: number[], version: number): Promise<CachedSlice[]>;
  /** Takes one of the user's hourly lookups; false when they are out. */
  takeLookup(): Promise<boolean>;
  /** Claims slices to fetch; returns the ones this call got. */
  claim(slices: Slice[], version: number): Promise<Slice[]>;
  /** Takes STRATZ calls from the hourly budget; false when it is spent. */
  takeStratz(calls: number): Promise<boolean>;
  /** Saves fetched slices and releases their claims. */
  save(slices: (Slice & { games: MatchupGame[] })[], version: number): Promise<void>;
  /** One STRATZ query, given the time left. */
  post<T>(query: string, timeoutMs: number): Promise<T>;
  now(): number;
}

export interface LookupInput {
  ours: { hero: number; position: number }[];
  theirs: number[];
  /** The first STRATZ game version of the current patch. */
  version: number;
}

/** Why some slices are still pending. */
export type PendingReason =
  | "user-limit"
  | "fetching-elsewhere"
  | "stratz-budget"
  | "stratz-busy"
  | "stratz-failed"
  | "time";

export interface LookupResult {
  slices: (Slice & { games: MatchupGame[]; stale: boolean })[];
  pending: Slice[];
  reasons: PendingReason[];
  /** With "stratz-busy": when asking again may fill the pending slices (ISO time). */
  retryAt?: string;
  /** The same as seconds from now, for clients whose clock is off. */
  retryIn?: number;
}

const key = (s: Slice) => `${s.hero}:${s.position}:${s.enemy}`;

/** Checks the request body; returns the input or a message for the user. */
export function parseInput(body: unknown): LookupInput | string {
  // Checked field by field below.
  const b = body as { ours?: unknown; theirs?: unknown; version?: unknown } | null;
  const isHero = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) < 1000;
  if (!b || !Array.isArray(b.ours) || !Array.isArray(b.theirs)) return "Send ours and theirs";
  if (b.ours.length < 1 || b.ours.length > 5 || b.theirs.length < 1 || b.theirs.length > 5) {
    return "Send 1 to 5 heroes a side";
  }
  const ours = b.ours.map((o) => ({ hero: o?.hero, position: o?.position }));
  if (!ours.every((o) => isHero(o.hero) && Number.isInteger(o.position) && o.position >= 1 && o.position <= 5)) {
    return "Each of our heroes needs a hero id and a position 1 to 5";
  }
  if (!b.theirs.every(isHero)) return "Enemy heroes are hero ids";
  const all = [...ours.map((o) => o.hero), ...b.theirs];
  if (new Set(all).size !== all.length) return "A hero can be picked once";
  if (new Set(ours.map((o) => o.position)).size !== ours.length) return "Each position once";
  if (!Number.isSafeInteger(b.version) || (b.version as number) <= 0) return "Send the game version";
  return {
    ours: ours as { hero: number; position: number }[],
    theirs: b.theirs as number[],
    version: b.version as number,
  };
}

/** Runs `tasks` with at most `limit` at once; a task that throws leaves its result undefined. */
async function inPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<(T | undefined)[]> {
  const out: (T | undefined)[] = Array(tasks.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try {
        out[i] = await tasks[i]!();
      } catch (err) {
        console.error("STRATZ match query failed", err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

/**
 * Fetches the claimed slices from STRATZ within `deadline`. A slice comes back only when its
 * lists and every one of its matches answered; the rest stay unfetched. `busy` is the first 429
 * on a match query, if any (a 429 on the lists throws).
 */
async function fetchSlices(deps: LookupDeps, claimed: Slice[], version: number, deadline: number) {
  const left = () => deadline - deps.now();
  const lists = await deps.post<Record<string, unknown>>(guideListQuery(claimed), left());
  const ids = claimed.map((_, i) => ({
    wins: guideMatchIds(lists[`w${i}`]),
    losses: guideMatchIds(lists[`l${i}`]),
  }));
  const all = [...new Set(ids.flatMap((s) => [...s.wins, ...s.losses]))];
  const batches: number[][] = [];
  for (let i = 0; i < all.length; i += MATCHES_PER_QUERY) batches.push(all.slice(i, i + MATCHES_PER_QUERY));
  const answers = new Map<number, unknown>();
  let busy: StratzBusy | undefined;
  const results = await inPool(
    batches.map((batch) => async () => {
      if (left() <= 0) throw new Error("Out of time");
      // After a refusal, asking again only makes STRATZ wait longer.
      if (busy) throw busy;
      const data = await deps.post<Record<string, unknown>>(matchesQuery(batch), left()).catch((err: unknown) => {
        if (err instanceof StratzBusy) busy ??= err;
        throw err;
      });
      batch.forEach((id, i) => answers.set(id, data[`m${i}`]));
      return true;
    }),
    CONCURRENCY,
  );
  const failed = new Set(batches.flatMap((b, i) => (results[i] ? [] : b)));
  const done = claimed.flatMap((s, i) => {
    const { wins, losses } = ids[i]!;
    if ([...wins, ...losses].some((id) => failed.has(id))) return [];
    const games = sliceGames(
      [
        ...wins.map((id) => toMatchupGame(answers.get(id), s, true)),
        ...losses.map((id) => toMatchupGame(answers.get(id), s, false)),
      ],
      version,
    );
    return [{ ...s, games }];
  });
  return { done, busy };
}

export async function lookupMatchups(deps: LookupDeps, input: LookupInput): Promise<LookupResult> {
  const slices: Slice[] = input.ours.flatMap((o) => input.theirs.map((enemy) => ({ ...o, enemy })));
  const cached = new Map(
    (await deps.readCache(input.ours.map((o) => o.hero), input.theirs, input.version)).map((c) => [key(c), c]),
  );
  const isFresh = (c: CachedSlice | undefined) => !!c && deps.now() - Date.parse(c.fetchedAt) < FRESH_DAYS * DAY_MS;
  const fetched = new Map<string, MatchupGame[]>();
  const reasons = new Set<PendingReason>();
  let retryAt: number | undefined;
  const busyUntil = (at: number) => {
    reasons.add("stratz-busy");
    retryAt = Math.max(retryAt ?? at, at);
  };
  // A 429 holds every lookup back, not only this one.
  const refused = async (err: StratzBusy) => {
    const until = deps.now() + err.retryAfterMs;
    busyUntil(until);
    await deps.noteBusy(until);
  };
  const missing = slices.filter((s) => !isFresh(cached.get(key(s))));

  const freeAt = missing.length > 0 ? await deps.freeAt() : null;

  if (freeAt !== null) {
    // Before the user's lookup and the budget are taken: nothing is asked of STRATZ.
    busyUntil(Date.parse(freeAt));
  } else if (missing.length > 0) {
    if (!(await deps.takeLookup())) {
      reasons.add("user-limit");
    } else {
      const claimed = await deps.claim(missing, input.version);
      if (claimed.length < missing.length) reasons.add("fetching-elsewhere");
      if (claimed.length > 0) {
        if (!(await deps.takeStratz(queriesNeeded(claimed.length)))) {
          reasons.add("stratz-budget");
        } else {
          const deadline = deps.now() + BUDGET_MS;
          try {
            const { done, busy } = await fetchSlices(deps, claimed, input.version, deadline);
            if (done.length > 0) await deps.save(done, input.version);
            for (const s of done) fetched.set(key(s), s.games);
            // After the whole slices are saved, so a failure noting the 429 loses none of them.
            if (busy) await refused(busy);
            if (done.length < claimed.length && !busy) reasons.add("time");
          } catch (err) {
            if (err instanceof StratzBusy) {
              await refused(err);
            } else {
              console.error("Matchup lookup failed", err);
              reasons.add("stratz-failed");
            }
          }
        }
      }
    }
  }

  const out: LookupResult = { slices: [], pending: [], reasons: [...reasons] };
  if (retryAt !== undefined) {
    out.retryAt = new Date(retryAt).toISOString();
    out.retryIn = Math.max(Math.ceil((retryAt - deps.now()) / 1000), 0);
  }
  for (const s of slices) {
    const games = fetched.get(key(s));
    const c = cached.get(key(s));
    if (games) out.slices.push({ ...s, games, stale: false });
    else if (c) out.slices.push({ ...s, games: c.games, stale: !isFresh(c) });
    else out.pending.push(s);
  }
  return out;
}
