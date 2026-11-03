/**
 * Hero vs hero and hero with hero counts from STRATZ: every ranked game of the recent weeks, all
 * ranks and per rank group, with hundreds to thousands of games per pair. Our own sample of public
 * matches has about a tenth of that, too few to see real counters (Medusa vs Nyx Assassin: 56
 * games in our sample, 1547 at STRATZ, 39.4% win rate).
 *
 * The counts replace the whole matchup and synergy part of the snapshot or none of it: each
 * hero's expected win rate comes from the same rows as its pairs (see Engine.edge), so rows from
 * two sources must never be mixed.
 */
import { type GamesWins, type RankGroup, type Snapshot } from "../engine/types";

/** STRATZ basic bracket pairs, in our rank group order (1 = Herald and Guardian). */
const BRACKETS: Record<RankGroup, string> = {
  1: "HERALD_GUARDIAN",
  2: "CRUSADER_ARCHON",
  3: "LEGEND_ANCIENT",
  4: "DIVINE_IMMORTAL",
};
const GROUPS = [0, 1, 2, 3, 4] as const;
/** Heroes per query: 10 heroes x 5 slices is 50 aliases, about 600 KB, under a second. */
export const HEROES_PER_QUERY = 10;
/** A slice needs pairs for at least this share of the other heroes, or the answer is incomplete. */
const MIN_PAIR_SHARE = 0.9;

interface PairRow {
  heroId2?: unknown;
  matchCount?: unknown;
  winCount?: unknown;
}
interface MatchUpRow {
  heroId?: unknown;
  vs?: PairRow[] | null;
  with?: PairRow[] | null;
}

type Matchups = Snapshot["matchups"];
type Synergy = Snapshot["synergy"];
export interface StratzCounts {
  matchups: Matchups;
  synergy: Synergy;
  rankMatchups: Record<string, Matchups>;
  rankSynergy: Record<string, Synergy>;
}

/** One query for a few heroes: an alias per hero and slice (0 = all ranks, 1-4 = rank group). */
export function matchUpQuery(heroIds: number[]): string {
  if (heroIds.length === 0 || heroIds.length > HEROES_PER_QUERY || !heroIds.every(Number.isSafeInteger)) {
    throw new Error(`Expected 1 to ${HEROES_PER_QUERY} hero ids, got ${heroIds.length}`);
  }
  const pairs = "{ heroId2 matchCount winCount }";
  const aliases = heroIds.flatMap((id) =>
    GROUPS.map((g) => {
      const brackets = g ? `bracketBasicIds: [${BRACKETS[g]}], ` : "";
      return `h${id}_${g}: matchUp(heroId: ${id}, ${brackets}take: 200) { heroId vs ${pairs} with ${pairs} }`;
    }),
  );
  return `{ heroStats { ${aliases.join(" ")} } }`;
}

const count = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);

/** Valid pairs of one list, by the other hero's id. Rows with bad numbers are dropped. */
function pairsOf(rows: PairRow[] | null | undefined, self: number): Map<number, GamesWins> {
  const out = new Map<number, GamesWins>();
  for (const r of rows ?? []) {
    const other = r.heroId2;
    const games = count(r.matchCount);
    const wins = count(r.winCount);
    if (typeof other !== "number" || other === self || games === undefined || wins === undefined || wins > games) continue;
    if (games > 0) out.set(other, { games, wins });
  }
  return out;
}

/**
 * Turns the answers into snapshot counts. Throws when a hero or slice is missing or has pairs
 * for too few heroes, so a partial answer never replaces the counts.
 */
export function toStratzCounts(heroIds: number[], answers: Record<string, MatchUpRow[] | null | undefined>): StratzCounts {
  const out: StratzCounts = { matchups: {}, synergy: {}, rankMatchups: {}, rankSynergy: {} };
  const minPairs = Math.floor((heroIds.length - 1) * MIN_PAIR_SHARE);
  for (const id of heroIds) {
    for (const g of GROUPS) {
      const row = answers[`h${id}_${g}`]?.find((r) => r.heroId === id);
      if (!row) throw new Error(`STRATZ matchups: no answer for hero ${id}, slice ${g}`);
      const vs = pairsOf(row.vs, id);
      if (vs.size < minPairs) throw new Error(`STRATZ matchups: hero ${id}, slice ${g} has ${vs.size} pairs, expected ${minPairs}+`);
      const matchups = g ? (out.rankMatchups[g] ??= {}) : out.matchups;
      const synergy = g ? (out.rankSynergy[g] ??= {}) : out.synergy;
      matchups[id] = Object.fromEntries([...vs].map(([other, gw]) => [String(other), gw]));
      // Each pair comes back from both heroes' rows; keep the one from the lower id.
      for (const [other, gw] of pairsOf(row.with, id)) if (id < other) synergy[`${id}-${other}`] = gw;
    }
  }
  return out;
}

/** Downloads every hero's counts, HEROES_PER_QUERY heroes per query. */
export async function fetchStratzCounts(heroIds: number[], post: (query: string) => Promise<{ heroStats?: Record<string, MatchUpRow[]> }>): Promise<StratzCounts> {
  const answers: Record<string, MatchUpRow[] | null | undefined> = {};
  for (let i = 0; i < heroIds.length; i += HEROES_PER_QUERY) {
    const data = await post(matchUpQuery(heroIds.slice(i, i + HEROES_PER_QUERY)));
    if (!data.heroStats) throw new Error("STRATZ matchups failed: no heroStats in the answer");
    Object.assign(answers, data.heroStats);
  }
  return toStratzCounts(heroIds, answers);
}

/** Puts the counts in the snapshot in place of the old ones, and marks where they came from. */
export function applyStratzCounts(snapshot: Snapshot, counts: StratzCounts, now: Date) {
  snapshot.matchups = counts.matchups;
  snapshot.synergy = counts.synergy;
  snapshot.rankMatchups = counts.rankMatchups;
  snapshot.rankSynergy = counts.rankSynergy;
  snapshot.matchupsFrom = { source: "stratz", at: now.toISOString() };
}
