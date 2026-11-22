/**
 * The game search behind Similar Games: one OpenDota explorer query per draft finds, for each of our five heroes,
 * this patch's high-rank ranked All Pick games of that hero, how many of our five enemies were on the other team
 * (shared enemies) and how many of our other four heroes on his team (shared allies). OpenDota's public_matches
 * has every team but no roles or stats; the details come from STRATZ later (details.ts).
 *
 * The SQL is built only from checked integers. Every answer row is checked field by field.
 */

const EXPLORER = "https://api.opendota.com/api/explorer";

/** Changes the cache key when the search rules change, so old answers are not reused. */
export const SEARCH_RULES_VERSION = 1;
/** Divine and up: OpenDota's average rank tier of the match (tens digit is the medal). */
export const MIN_RANK_TIER = 70;
const RANKED_LOBBY = 7;
const ALL_PICK = 22;
/** Game rows per hero in the answer, most similar first. */
export const GAMES_PER_HERO = 300;
/** The fewest games a level needs: 3 shared enemies first, else 2, else the hero has no Similar Games. */
export const MIN_GAMES = 20;
/** The explorer usually answers in about 5 seconds. */
export const SEARCH_TIMEOUT_MS = 10_000;

export interface SearchInput {
  /** Our five heroes. */
  ours: number[];
  /** The five enemies. */
  enemies: number[];
  /** The patch start, Unix seconds. */
  patchStart: number;
}

/** One game of one of our heroes, as the search sees it. */
export interface SearchGame {
  match: number;
  won: boolean;
  /** Unix seconds. */
  startTime: number;
  /** Seconds. */
  duration: number;
  sharedEnemies: number;
  sharedAllies: number;
  /** The other team's heroes. */
  enemies: number[];
  /** His team's heroes, him included. */
  allies: number[];
}

export interface HeroSearch {
  hero: number;
  /** Games and wins by shared enemies, index 0 to 5. */
  levels: { games: number; wins: number }[];
  /** 3 when it has MIN_GAMES games with 3 or more shared enemies, else 2 when it has them with 2 or more, else null. */
  level: 3 | 2 | null;
  /** Games at the level or above, most similar first (shared enemies, shared allies, newest). Empty when level is null. */
  games: SearchGame[];
}

const isHero = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1000;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Throws when the input can't go into the SQL: five distinct heroes a side, no hero on both, a sane patch start. */
export function checkSearchInput(input: SearchInput, nowSeconds: number): void {
  const all = [...input.ours, ...input.enemies];
  if (input.ours.length !== 5 || input.enemies.length !== 5 || !all.every(isHero) || new Set(all).size !== 10) {
    throw new Error("Expected five different heroes on each side");
  }
  const start = input.patchStart;
  // Not in the future, and not older than half a year (a patch is weeks long; an older start scans too much).
  if (!Number.isInteger(start) || start > nowSeconds || start < nowSeconds - 183 * 24 * 60 * 60) {
    throw new Error(`Bad patch start ${start}`);
  }
}

/** The cache key of a search: rules version, patch start, our heroes and the enemies, each sorted. */
export function searchKey(input: SearchInput): string {
  const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b).join(",");
  return `${SEARCH_RULES_VERSION}:${input.patchStart}:${sorted(input.ours)}:${sorted(input.enemies)}`;
}

/** The explorer SQL for a checked input. */
export function searchSql(input: SearchInput): string {
  const heroes = input.ours.map((h) => `(${h})`).join(",");
  const enemies = `array[${input.enemies.join(",")}]`;
  const ours = `array[${input.ours.join(",")}]`;
  return `with h(hero) as (values ${heroes}),
m as (select match_id, start_time, duration, radiant_win, radiant_team r, dire_team d from public_matches
  where start_time >= ${input.patchStart} and lobby_type = ${RANKED_LOBBY} and game_mode = ${ALL_PICK}
    and avg_rank_tier >= ${MIN_RANK_TIER}),
x as (select h.hero, m.match_id, m.start_time, m.duration, (h.hero = any(m.r)) = m.radiant_win as won,
    case when h.hero = any(m.r) then m.d else m.r end as enemy,
    case when h.hero = any(m.r) then m.r else m.d end as ally
  from h join m on h.hero = any(m.r) or h.hero = any(m.d)),
y as (select x.*, cardinality(array(select unnest(enemy) intersect select unnest(${enemies}))) as se,
    cardinality(array(select unnest(ally) intersect select unnest(${ours}))) - 1 as sa
  from x),
g as (select y.*, row_number() over (partition by hero order by se desc, sa desc, match_id desc) as n
  from y where se >= 2)
select 'level' as kind, hero, se, 0 as sa, count(*)::int as games, sum(won::int)::int as wins,
  null::bigint as match_id, null::int as start_time, null::int as duration, null::int[] as enemy, null::int[] as ally
from y group by hero, se
union all
select 'game', hero, se, sa, 1, won::int, match_id, start_time, duration, enemy, ally
from g where n <= ${GAMES_PER_HERO}`;
}

/** One answer row, as the explorer sends it (bigint columns can come as strings). */
interface Row {
  kind?: unknown;
  hero?: unknown;
  se?: unknown;
  sa?: unknown;
  games?: unknown;
  wins?: unknown;
  match_id?: unknown;
  start_time?: unknown;
  duration?: unknown;
  enemy?: unknown;
  ally?: unknown;
}

const toInt = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : null;
};
const isTeam = (v: unknown): v is number[] => Array.isArray(v) && v.length === 5 && v.every(isHero);

/**
 * Reads the explorer's rows into one search per hero, in the order of `ours`. Throws on any row it can't read,
 * so a changed answer is a failure, never a wrong count.
 */
export function readSearch(rows: unknown, ours: number[]): HeroSearch[] {
  if (!Array.isArray(rows)) throw new Error("Explorer answer has no rows");
  const byHero = new Map(ours.map((hero): [number, HeroSearch] => [hero, {
    hero,
    levels: Array.from({ length: 6 }, () => ({ games: 0, wins: 0 })),
    level: null,
    games: [],
  }]));
  for (const row of rows as Row[]) {
    const search = byHero.get(toInt(row?.hero) ?? -1);
    const se = toInt(row?.se);
    if (!search || se === null || se < 0 || se > 5) throw new Error(`Bad explorer row ${JSON.stringify(row)}`);
    if (row.kind === "level") {
      const games = toInt(row.games);
      const wins = toInt(row.wins);
      if (!isCount(games) || !isCount(wins) || wins > games) throw new Error(`Bad level row ${JSON.stringify(row)}`);
      search.levels[se] = { games, wins };
    } else if (row.kind === "game") {
      const match = toInt(row.match_id);
      const sa = toInt(row.sa);
      const startTime = toInt(row.start_time);
      const duration = toInt(row.duration);
      const wins = toInt(row.wins);
      if (
        !match || match <= 0 || sa === null || sa < 0 || sa > 4 || !startTime || !isCount(duration) ||
        (wins !== 0 && wins !== 1) || !isTeam(row.enemy) || !isTeam(row.ally) || !row.ally.includes(search.hero)
      ) throw new Error(`Bad game row ${JSON.stringify(row)}`);
      search.games.push({
        match,
        won: wins === 1,
        startTime,
        duration,
        sharedEnemies: se,
        sharedAllies: sa,
        enemies: row.enemy,
        allies: row.ally,
      });
    } else {
      throw new Error(`Unknown explorer row kind ${JSON.stringify(row.kind)}`);
    }
  }
  return ours.map((hero) => withLevel(byHero.get(hero)!)); // Every hero of `ours` is in the map.
}

/** Picks the level and keeps only its games, most similar first. */
function withLevel(search: HeroSearch): HeroSearch {
  const atLeast = (n: number) => search.levels.slice(n).reduce((sum, l) => sum + l.games, 0);
  const level = atLeast(3) >= MIN_GAMES ? 3 : atLeast(2) >= MIN_GAMES ? 2 : null;
  const games = level === null ? [] : search.games
    .filter((g) => g.sharedEnemies >= level)
    .sort((a, b) => b.sharedEnemies - a.sharedEnemies || b.sharedAllies - a.sharedAllies || b.match - a.match);
  return { ...search, level, games };
}

/**
 * Runs the search. Throws on a timeout, an HTTP error or an explorer error (the explorer can answer 200 with `err`),
 * so the caller fails closed.
 */
export async function searchGames(
  input: SearchInput,
  nowSeconds: number,
  fetchFn: typeof fetch = fetch,
): Promise<HeroSearch[]> {
  checkSearchInput(input, nowSeconds);
  const url = `${EXPLORER}?sql=${encodeURIComponent(searchSql(input))}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  // The shape is checked right below and in readSearch.
  const body = (await res.json().catch(() => null)) as { rows?: unknown; err?: unknown } | null;
  if (!res.ok || !body || body.err) {
    throw new Error(`OpenDota explorer failed: ${body?.err ? String(body.err) : `HTTP ${res.status}`}`);
  }
  return readSearch(body.rows, input.ours);
}
