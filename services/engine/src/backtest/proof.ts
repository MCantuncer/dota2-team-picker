/**
 * The numbers for the public Proof Page: how often players who took one of the engine's top 3
 * picks won, against players who did not, on saved ranked games with their real pick order. Each
 * game is scored with the hero data the website had before it started (see live.ts), and the same
 * is done for two simple rivals, so the page can say how much the engine adds over them.
 */
import type { EvalMatch } from "../data/eval-matches";
import type { Engine } from "../engine/score";
import { rankGroup, type Position, type Snapshot } from "../engine/types";
import { bracketOf, draftAt, engineSuggester, metaSuggester, popularSuggester } from "./backtest";

const TOP = 8;
const LIFT_TOP = 3;
const Z95 = 1.96;
/** The running line starts once the top 3 has this many picks, so its first points are not noise. */
export const RUNNING_MIN_PICKS = 150;
/** Example games on the page. */
export const EXAMPLES = 6;

export type Rival = "engine" | "meta" | "popular";
export const RIVALS: Rival[] = ["engine", "meta", "popular"];

/** One scored pick: who took what, and where each suggester ranked it (-1: not in its top 8). */
export interface PickRecord {
  matchId: number;
  startTime: number;
  rankTier: number | null;
  heroId: number;
  position: Position;
  /** The team's pick round: 0 first (its 1st or 2nd pick), 1 second (3rd or 4th), 2 last (5th). */
  round: 0 | 1 | 2;
  won: boolean;
  /** The engine's first choice for this player. */
  engineFirst: number | null;
  at: Record<Rival, number>;
}

/** Every pick with a known position in these games, scored by the engine and both rivals. */
export function pickRecords(engine: Engine, games: EvalMatch[]): PickRecord[] {
  const suggest = { engine: engineSuggester(engine), meta: metaSuggester(engine), popular: popularSuggester(engine) };
  const records: PickRecord[] = [];
  for (const game of games) {
    const teamPicks = { radiant: 0, dire: 0 };
    game.picks.forEach((pick, i) => {
      const side = pick.radiant ? "radiant" : "dire";
      const teamIndex = teamPicks[side]++;
      const input = draftAt(game, i, TOP);
      if (!input || !pick.position) return;
      const lists = Object.fromEntries(RIVALS.map((r) => [r, suggest[r](input).slice(0, TOP)])) as Record<Rival, number[]>;
      records.push({
        matchId: game.id,
        startTime: game.startTime,
        rankTier: game.rankTier,
        heroId: pick.heroId,
        position: pick.position,
        round: teamIndex < 2 ? 0 : teamIndex < 4 ? 1 : 2,
        won: pick.radiant === game.radiantWin,
        engineFirst: lists.engine[0] ?? null,
        at: Object.fromEntries(RIVALS.map((r) => [r, lists[r].indexOf(pick.heroId)])) as Record<Rival, number>,
      });
    });
  }
  return records;
}

/** Win rates (0-1) of picks in a suggester's top 3 and of the rest, and the lift between them with its 95% margin. */
export interface Lift {
  top3: { picks: number; won: number };
  other: { picks: number; won: number };
  /** top3.won - other.won, and the margin around it; null when either group is empty. */
  lift: number | null;
  margin: number | null;
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

export function liftOf(records: PickRecord[], rival: Rival = "engine"): Lift {
  const top = { picks: 0, wins: 0 };
  const rest = { picks: 0, wins: 0 };
  for (const r of records) {
    const group = r.at[rival] >= 0 && r.at[rival] < LIFT_TOP ? top : rest;
    group.picks++;
    if (r.won) group.wins++;
  }
  const rate = (g: { picks: number; wins: number }) => (g.picks ? g.wins / g.picks : 0);
  const a = rate(top);
  const b = rate(rest);
  const both = top.picks > 0 && rest.picks > 0;
  const se = both ? Math.sqrt((a * (1 - a)) / top.picks + (b * (1 - b)) / rest.picks) : 0;
  return {
    top3: { picks: top.picks, won: round4(a) },
    other: { picks: rest.picks, won: round4(b) },
    lift: both ? round4(a - b) : null,
    margin: both ? round4(Z95 * se) : null,
  };
}

export interface ProofExample {
  matchId: number;
  startTime: number;
  rankTier: number | null;
  heroId: number;
  position: Position;
  round: 0 | 1 | 2;
  won: boolean;
}

export interface Proof {
  computedAt: string;
  /** UTC days of the first and last game. */
  from: string;
  to: string;
  games: number;
  picks: number;
  /** Lift and top 8 hit rate of the engine and the two rivals. */
  rivals: Record<Rival, Lift & { hitTop8: number }>;
  /** The engine's lift on all games up to each day, from the day the top 3 had enough picks. */
  running: { day: string; games: number; lift: number; margin: number }[];
  /** The engine's lift by rank group ("1" Herald and Guardian ... "4" Divine and Immortal). */
  byRank: Record<string, Lift>;
  /** The engine's lift by position ("1" to "5"). */
  byRole: Record<string, Lift>;
  /** The engine's lift by the team's pick round ("0" first, "1" second, "2" last). */
  byRound: Record<string, Lift>;
  /**
   * The newest picks where the player took the engine's first choice, one per hero, whatever the
   * result, so the page shows real games rather than chosen wins.
   */
  examples: ProofExample[];
  /** The checked win range bands of the same run, for the page's win chance check; null when none passed. */
  winRange: Snapshot["winRange"] | null;
}

const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

function groupBy(records: PickRecord[], key: (r: PickRecord) => string | null): Record<string, Lift> {
  const groups = new Map<string, PickRecord[]>();
  for (const r of records) {
    const k = key(r);
    if (k === null) continue;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, list]) => [k, liftOf(list)]));
}

/** All the Proof Page numbers from scored picks. Null when there are none. */
export function proofOf(records: PickRecord[], computedAt: string, winRange: Snapshot["winRange"] | null = null): Proof | null {
  if (records.length === 0) return null;
  const sorted = [...records].sort((a, b) => a.startTime - b.startTime);
  const rivals = Object.fromEntries(
    RIVALS.map((r) => [r, { ...liftOf(sorted, r), hitTop8: round4(sorted.filter((p) => p.at[r] >= 0).length / sorted.length) }]),
  ) as Proof["rivals"];

  const running: Proof["running"] = [];
  const seen = new Set<number>();
  let end = 0;
  while (end < sorted.length) {
    const day = dayOf(sorted[end]!.startTime);
    while (end < sorted.length && dayOf(sorted[end]!.startTime) === day) seen.add(sorted[end++]!.matchId);
    const lift = liftOf(sorted.slice(0, end));
    if (lift.top3.picks >= RUNNING_MIN_PICKS && lift.lift !== null && lift.margin !== null) {
      running.push({ day, games: seen.size, lift: lift.lift, margin: lift.margin });
    }
  }

  const examples: ProofExample[] = [];
  const heroes = new Set<number>();
  for (const r of [...sorted].reverse()) {
    if (r.at.engine !== 0 || heroes.has(r.heroId)) continue;
    heroes.add(r.heroId);
    const { matchId, startTime, rankTier, heroId, position, round, won } = r;
    examples.push({ matchId, startTime, rankTier, heroId, position, round, won });
    if (examples.length === EXAMPLES) break;
  }

  return {
    computedAt,
    from: dayOf(sorted[0]!.startTime),
    to: dayOf(sorted.at(-1)!.startTime),
    games: new Set(sorted.map((r) => r.matchId)).size,
    picks: sorted.length,
    rivals,
    running,
    byRank: groupBy(sorted, (r) => {
      const bracket = bracketOf(r.rankTier);
      return bracket ? String(rankGroup(bracket)) : null;
    }),
    byRole: groupBy(sorted, (r) => String(r.position)),
    byRound: groupBy(sorted, (r) => String(r.round)),
    examples,
    winRange,
  };
}
