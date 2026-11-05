/**
 * Lane results per hero pair from STRATZ (`heroStats.laneOutcome`): how often hero a won, drew or lost
 * the lane against hero b, all ranks and per rank group (richer Game Story proposal, step 2). Today's
 * lane verdict sums whole-game matchups, but a hero can lose the lane and still win the game; these
 * counts are about the lane itself.
 *
 * STRATZ counts a big lane win or loss as a "stomp" on its own, outside winCount and lossCount, so a
 * stomp is added to its side here. A pair with fewer than MIN_LANE_GAMES games is left out.
 */
import type { LaneCounts, RankGroup, Snapshot } from "../engine/types";

const BRACKETS: Record<RankGroup, string> = {
  1: "HERALD_GUARDIAN",
  2: "CRUSADER_ARCHON",
  3: "LEGEND_ANCIENT",
  4: "DIVINE_IMMORTAL",
};
const GROUPS = [0, 1, 2, 3, 4] as const;
/** Heroes per query: 10 heroes x 5 slices is 50 aliases, under STRATZ's 60. */
export const LANE_HEROES_PER_QUERY = 10;
/** Pairs with fewer lane games than this are too noisy to name and are left out. */
export const MIN_LANE_GAMES = 300;
/** A slice needs pairs for at least this share of the other heroes, or the answer is incomplete. */
const MIN_PAIR_SHARE = 0.5;

interface LaneRow {
  heroId1?: unknown;
  heroId2?: unknown;
  matchCount?: unknown;
  winCount?: unknown;
  drawCount?: unknown;
  lossCount?: unknown;
  stompWinCount?: unknown;
  stompLossCount?: unknown;
}

/** laneOutcomes[slice][a][b]: hero a's lane against hero b; slice "0" = all ranks, "1"-"4" = RankGroup. */
export type LaneOutcomes = NonNullable<Snapshot["laneOutcomes"]>;

/** One query for a few heroes: an alias per hero and slice. */
export function laneQuery(heroIds: number[]): string {
  if (heroIds.length === 0 || heroIds.length > LANE_HEROES_PER_QUERY || !heroIds.every(Number.isSafeInteger)) {
    throw new Error(`Expected 1 to ${LANE_HEROES_PER_QUERY} hero ids, got ${heroIds.length}`);
  }
  const fields = "{ heroId1 heroId2 matchCount winCount drawCount lossCount stompWinCount stompLossCount }";
  const aliases = heroIds.flatMap((id) =>
    GROUPS.map((g) => {
      const brackets = g ? `, bracketBasicIds: [${BRACKETS[g]}]` : "";
      return `l${id}_${g}: laneOutcome(heroId: ${id}, isWith: false${brackets}) ${fields}`;
    }),
  );
  return `{ heroStats { ${aliases.join(" ")} } }`;
}

const count = (x: unknown) => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : undefined);

/** A row as counts, or undefined when its numbers are bad or it has too few games. */
function toCounts(r: LaneRow): LaneCounts | undefined {
  const n = [r.matchCount, r.winCount, r.drawCount, r.lossCount].map(count);
  const [games, win, drawn, loss] = n;
  if (games === undefined || win === undefined || drawn === undefined || loss === undefined) return undefined;
  // Older answers may lack the stomp fields; then they are 0.
  const won = win + (count(r.stompWinCount) ?? 0);
  const lost = loss + (count(r.stompLossCount) ?? 0);
  if (won + drawn + lost > games || games < MIN_LANE_GAMES) return undefined;
  return [games, won, drawn, lost];
}

/**
 * Turns the answers into lane counts. Throws when a hero or slice is missing or covers too few heroes,
 * so a partial answer never replaces the counts.
 */
export function toLaneOutcomes(heroIds: number[], answers: Record<string, LaneRow[] | null | undefined>): LaneOutcomes {
  const out: LaneOutcomes = {};
  const minPairs = Math.floor((heroIds.length - 1) * MIN_PAIR_SHARE);
  for (const id of heroIds) {
    for (const g of GROUPS) {
      const rows = answers[`l${id}_${g}`];
      if (!rows) throw new Error(`STRATZ lanes: no answer for hero ${id}, slice ${g}`);
      const pairs: Record<string, LaneCounts> = {};
      for (const r of rows) {
        if (r.heroId1 !== id || typeof r.heroId2 !== "number" || r.heroId2 === id) continue;
        const c = toCounts(r);
        if (c) pairs[String(r.heroId2)] = c;
      }
      // Rank groups have fewer games, so only all ranks must cover most heroes.
      const size = Object.keys(pairs).length;
      if (g === 0 && size < minPairs) throw new Error(`STRATZ lanes: hero ${id} has ${size} pairs, expected ${minPairs}+`);
      (out[String(g)] ??= {})[String(id)] = pairs;
    }
  }
  return out;
}

/** Lane counts change slowly; they are downloaded once a week. */
export const LANES_MAX_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the lane counts are missing or older than LANES_MAX_AGE_DAYS. */
export function lanesDue(snapshot: Snapshot, now: Date): boolean {
  if (!snapshot.laneOutcomesAt || !snapshot.laneOutcomes) return true;
  return now.getTime() - Date.parse(snapshot.laneOutcomesAt) >= LANES_MAX_AGE_DAYS * DAY_MS;
}

/** Downloads every hero's lane counts, LANE_HEROES_PER_QUERY heroes per query. */
export async function fetchLaneOutcomes(heroIds: number[], post: (query: string) => Promise<{ heroStats?: Record<string, LaneRow[]> }>): Promise<LaneOutcomes> {
  const answers: Record<string, LaneRow[] | null | undefined> = {};
  for (let i = 0; i < heroIds.length; i += LANE_HEROES_PER_QUERY) {
    const data = await post(laneQuery(heroIds.slice(i, i + LANE_HEROES_PER_QUERY)));
    if (!data.heroStats) throw new Error("STRATZ lanes failed: no heroStats in the answer");
    Object.assign(answers, data.heroStats);
  }
  return toLaneOutcomes(heroIds, answers);
}
