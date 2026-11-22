/**
 * The Similar Games lookup behind the similar-games function. The search (one OpenDota explorer query for all five
 * of our heroes) comes from the cache when under SEARCH_FRESH_MS old. Then, for each asked hero, the most similar
 * games are read from the match cache, and the ones missing are fetched from STRATZ, 20 a query, within a time
 * budget. Every limit fails closed: the answer then has what the caches have and says it is pending, with a time
 * to ask again, like the matchup lookup (matchup/lookup.ts) whose STRATZ turn-taking it shares.
 */
import { type HeroPick, pickGames, type SimilarGame } from "./answer.ts";
import { detailsQuery, MATCHES_PER_QUERY, readDetails, type SimilarMatch } from "./details.ts";
import { type HeroSearch, type SearchInput, searchKey } from "./search.ts";
import { StratzBusy } from "../matchup/stratz.ts";

/** A cached search younger than this is used as is. */
export const SEARCH_FRESH_MS = 6 * 60 * 60 * 1000;
/** The STRATZ part of a lookup must finish within this. */
export const BUDGET_MS = 8000;
/** STRATZ queries one lookup takes at most. */
export const QUERIES_PER_LOOKUP = 5;
/** How soon to ask again while another call is fetching the same thing. */
export const RETRY_SOON_S = 10;

export interface SimilarInput {
  ours: { hero: number; position: number }[];
  enemies: number[];
  /** Our heroes whose games to read now (the viewer's first); the search always covers all five. */
  heroes: number[];
}

/** Everything the lookup talks to, so tests can pass stand-ins. Each throws on an error. */
export interface SimilarDeps {
  now(): number;
  readSearch(key: string): Promise<{ heroes: HeroSearch[]; fetchedAt: string } | null>;
  saveSearch(key: string, heroes: HeroSearch[]): Promise<void>;
  /** Claims keys ("s:" + search key, "m:" + match id); returns the ones this call got. */
  claim(keys: string[]): Promise<string[]>;
  release(keys: string[]): Promise<void>;
  /** Takes one of the user's hourly lookups; false when they are out. */
  takeLookup(): Promise<boolean>;
  /** Takes one call from the OpenDota budget; false when it is spent. */
  takeOpenDota(): Promise<boolean>;
  search(input: SearchInput): Promise<HeroSearch[]>;
  /** Stored matches by id: null for one STRATZ could not give in full. */
  readMatches(ids: number[]): Promise<Map<number, SimilarMatch | null>>;
  /** Stores read matches, and the ids STRATZ could not give in full. */
  saveMatches(read: SimilarMatch[], unreadable: number[]): Promise<void>;
  /** When lookups may use STRATZ again (ISO time), or null when they may now. */
  stratzFreeAt(): Promise<string | null>;
  noteBusy(until: number): Promise<void>;
  takeStratz(calls: number): Promise<boolean>;
  post<T>(query: string, timeoutMs: number): Promise<T>;
}

export type SimilarReason = "user-limit" | "budget" | "searching-elsewhere" | "stratz-busy" | "failed" | "time";

export interface SimilarHeroResult {
  hero: number;
  level: 3 | 2 | null;
  /** Games the search found at the level, every role. */
  found: number;
  /** Games in his position, most similar first. */
  games: SimilarGame[];
  /** True while more of his games are still to be read. */
  pending: boolean;
}

export interface SimilarResult {
  heroes: SimilarHeroResult[];
  reasons: SimilarReason[];
  /** Seconds until asking again may fill what is pending. */
  retryIn?: number;
}

/** Runs one lookup. `patchStart` is the patch's start, Unix seconds, from the published hero data. */
export async function lookupSimilar(
  deps: SimilarDeps,
  input: SimilarInput,
  patchStart: number,
): Promise<SimilarResult> {
  const reasons = new Set<SimilarReason>();
  let retryAt: number | undefined;
  const later = (at: number) => (retryAt = Math.max(retryAt ?? at, at));
  const ours = input.ours.map((o) => o.hero);
  const key = searchKey({ ours, enemies: input.enemies, patchStart });
  let tookLookup = false;
  const takeLookup = async () => {
    if (!tookLookup) tookLookup = await deps.takeLookup();
    if (!tookLookup) reasons.add("user-limit");
    return tookLookup;
  };

  let searches = await deps.readSearch(key).then((c) =>
    c && deps.now() - Date.parse(c.fetchedAt) < SEARCH_FRESH_MS ? c.heroes : null
  );
  if (!searches) {
    const [claimed] = await deps.claim([`s:${key}`]);
    if (!claimed) {
      reasons.add("searching-elsewhere");
      later(deps.now() + RETRY_SOON_S * 1000);
    } else if (!(await takeLookup())) {
      await deps.release([claimed]);
    } else if (!(await deps.takeOpenDota())) {
      reasons.add("budget");
      await deps.release([claimed]);
    } else {
      try {
        searches = await deps.search({ ours, enemies: input.enemies, patchStart });
        await deps.saveSearch(key, searches);
      } catch (err) {
        console.error("Similar games search failed", err);
        reasons.add("failed");
      } finally {
        await deps.release([claimed]);
      }
    }
  }
  if (!searches) return finish([], reasons, retryAt, deps.now());

  const asked = input.heroes.flatMap((hero) => {
    const search = searches.find((s) => s.hero === hero);
    const position = input.ours.find((o) => o.hero === hero)?.position;
    return search && position ? [{ search, position }] : [];
  });
  const ids = [...new Set(asked.flatMap((a) => a.search.games.map((g) => g.match)))];
  const stored = ids.length > 0 ? await deps.readMatches(ids) : new Map<number, SimilarMatch | null>();
  const picks = () => asked.map((a) => pickGames(a.search, a.position, stored));
  const missing = (p: HeroPick[]) => [...new Set(p.flatMap((x) => x.missing))];

  if (missing(picks()).length > 0) {
    const freeAt = await deps.stratzFreeAt();
    if (freeAt !== null) {
      reasons.add("stratz-busy");
      later(Date.parse(freeAt));
    } else if (await takeLookup()) {
      await fetchMissing(deps, stored, () => missing(picks()), reasons, later);
    }
  }

  const heroes = asked.map((a, i): SimilarHeroResult => {
    const pick = picks()[i]!; // One pick per asked hero, in order.
    const level = a.search.level;
    const found = level === null ? 0 : a.search.levels.slice(level).reduce((sum, l) => sum + l.games, 0);
    return { hero: a.search.hero, level, found, games: pick.games, pending: pick.missing.length > 0 };
  });
  return finish(heroes, reasons, retryAt, deps.now());
}

/** Fetches missing matches, most similar first, a query at a time, until none are missing or a limit says stop. */
async function fetchMissing(
  deps: SimilarDeps,
  stored: Map<number, SimilarMatch | null>,
  nextMissing: () => number[],
  reasons: Set<SimilarReason>,
  later: (at: number) => void,
) {
  const deadline = deps.now() + BUDGET_MS;
  const skipped = new Set<number>();
  for (let query = 0; query < QUERIES_PER_LOOKUP; query++) {
    const wanted = nextMissing().filter((id) => !skipped.has(id)).slice(0, MATCHES_PER_QUERY);
    if (wanted.length === 0) return;
    // A query needs a second or more; with less left, the rest waits for the next ask.
    if (deadline - deps.now() < 1000) {
      reasons.add("time");
      return;
    }
    const claimed = (await deps.claim(wanted.map((id) => `m:${id}`))).map((k) => Number(k.slice(2)));
    wanted.filter((id) => !claimed.includes(id)).forEach((id) => skipped.add(id));
    if (claimed.length === 0) {
      later(deps.now() + RETRY_SOON_S * 1000);
      continue;
    }
    if (!(await deps.takeStratz(1))) {
      reasons.add("budget");
      await deps.release(claimed.map((id) => `m:${id}`));
      return;
    }
    try {
      const answer = await deps.post<Record<string, unknown>>(detailsQuery(claimed), deadline - deps.now());
      const read = readDetails(answer);
      const unreadable = claimed.filter((id) => !read.some((m) => m.match === id));
      await deps.saveMatches(read, unreadable);
      read.forEach((m) => stored.set(m.match, m));
      unreadable.forEach((id) => stored.set(id, null));
    } catch (err) {
      if (err instanceof StratzBusy) {
        const until = deps.now() + err.retryAfterMs;
        reasons.add("stratz-busy");
        later(until);
        await deps.noteBusy(until);
      } else {
        console.error("Similar games STRATZ query failed", err);
        reasons.add("failed");
      }
      return;
    } finally {
      await deps.release(claimed.map((id) => `m:${id}`));
    }
  }
}

function finish(heroes: SimilarHeroResult[], reasons: Set<SimilarReason>, retryAt: number | undefined, now: number) {
  const out: SimilarResult = { heroes, reasons: [...reasons] };
  if (retryAt !== undefined) out.retryIn = Math.max(Math.ceil((retryAt - now) / 1000), 0);
  return out;
}

/** Checks the request body; returns the input or a message for the user. */
export function parseSimilarInput(body: unknown): SimilarInput | string {
  // Checked field by field below.
  const b = body as { ours?: unknown; enemies?: unknown; heroes?: unknown } | null;
  const isHero = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) < 1000;
  if (!b || !Array.isArray(b.ours) || !Array.isArray(b.enemies) || !Array.isArray(b.heroes)) {
    return "Send ours, enemies and heroes";
  }
  if (b.ours.length !== 5 || b.enemies.length !== 5) return "Send five heroes a side";
  const ours = b.ours.map((o) => ({ hero: o?.hero, position: o?.position }));
  if (!ours.every((o) => isHero(o.hero) && Number.isInteger(o.position) && o.position >= 1 && o.position <= 5)) {
    return "Each of our heroes needs a hero id and a position 1 to 5";
  }
  if (!b.enemies.every(isHero)) return "Enemy heroes are hero ids";
  const all = [...ours.map((o) => o.hero), ...b.enemies];
  if (new Set(all).size !== 10) return "A hero can be picked once";
  if (new Set(ours.map((o) => o.position)).size !== 5) return "Each position once";
  const heroes = [...new Set(b.heroes)];
  if (heroes.length < 1 || !heroes.every((h) => ours.some((o) => o.hero === h))) return "Ask for our own heroes";
  return {
    ours: ours as { hero: number; position: number }[],
    enemies: b.enemies as number[],
    heroes: heroes as number[],
  };
}
