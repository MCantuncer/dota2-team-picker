/**
 * One plain verdict per listed hero, against the list's leader: is the leader a clear best pick, and why is
 * every other hero behind it. Can (2026-11-10): a clear winner and direct reasons, not "you can pick this,
 * you can pick that". The leader is always the best pick (the highest expected score is the best choice even
 * when the data can't prove it); "clear" is said only when the data does.
 */
import { points, ROLE_NAMES } from "./reasons";
import type { HeroPoints, Position, ScoreBreakdown, Suggestion } from "./types";

/** How many standard errors a gap must clear to be told apart from noise: the one-sided 95% line. */
export const VERDICT_Z = 1.645;
/** Record points one hero must lead the leader by before its card says the player wins more on it. */
export const RECORD_LEAD = 1;

export type VerdictKind = "clear" | "best" | "only" | "behind";

export interface Verdict {
  heroId: number;
  kind: VerdictKind;
  /** Where the hero stands against the leader, and why. */
  text: string;
  /** The player's own record when it favors this hero over the leader, on a line of its own; null otherwise. */
  note: string | null;
}

type Listed = Pick<Suggestion, "heroId" | "name" | "score" | "error" | "breakdown" | "counterBy" | "synergyBy" | "record">;

/** The gap two scores must clear: VERDICT_Z times their combined error. */
export const marginOf = (a: Pick<Suggestion, "error">, b: Pick<Suggestion, "error">) => VERDICT_Z * Math.hypot(a.error, b.error);

const one = (x: number) => x.toFixed(1);
const percent = (r: { games: number; wins: number }) => `${Math.round((r.wins / r.games) * 100)}%`;

/** The hero (enemy or ally) where the leader's points gain most over the other hero's, and by how much. */
function biggestLead(leader: HeroPoints[], other: HeroPoints[]): HeroPoints | null {
  let best: HeroPoints | null = null;
  for (const l of leader) {
    const lead = l.points - (other.find((o) => o.heroId === l.heroId)?.points ?? 0);
    if (lead > 0 && (!best || lead > best.points)) best = { heroId: l.heroId, points: lead };
  }
  return best;
}

/** Whose list it is: undefined for the reader's own ("you"), or a teammate's name on a Per Player column. */
type Owner = string | undefined;

/**
 * Why `s` is behind `leader`, from `s`'s side and short enough for a closed row: the score part where the leader
 * gains most, with the difference ("3.2 worse against Timbersaw").
 */
function whyBehind(leader: Listed, s: Listed, name: (id: number) => string, pos: Position, owner: Owner): string {
  const parts = Object.keys(leader.breakdown) as (keyof ScoreBreakdown)[];
  const part = parts.reduce((a, b) => (leader.breakdown[b] - s.breakdown[b] > leader.breakdown[a] - s.breakdown[a] ? b : a));
  const lead = leader.breakdown[part] - s.breakdown[part];
  const less = points(-lead);
  switch (part) {
    case "counter": {
      const enemy = biggestLead(leader.counterBy, s.counterBy);
      return enemy ? `${one(enemy.points)} worse against ${name(enemy.heroId)}` : `worse against the enemy picks (${less})`;
    }
    case "synergy": {
      const ally = biggestLead(leader.synergyBy, s.synergyBy);
      return ally ? `${one(ally.points)} worse with ${name(ally.heroId)}` : `works less with ${owner ? "the" : "your"} picks (${less})`;
    }
    case "meta":
      return `lower win rate (${less})`;
    case "positionFit":
      return `played as ${ROLE_NAMES[pos]} less often (${less})`;
    case "teamNeeds":
      return `adds less of what ${owner ? "the" : "your"} team lacks (${less})`;
    case "pickSafety":
      return `easier to punish now (${less})`;
    case "flex":
      return `fits fewer positions, so it shows ${owner ? "the" : "your"} plan (${less})`;
    case "comfort":
      return `${owner ? `${owner}'s` : "your"} record and stars favor ${leader.name} (${less})`;
  }
}

/**
 * "You win more on Puck (63% of 38 games) than on Invoker (49% of 83)." when the player's record on `s` beats
 * the leader's by RECORD_LEAD points and its plain win rate agrees, so the words never contradict the math.
 * With no games on the leader: "You have won 63% of 38 games on Puck and have no games on Invoker."
 */
function recordNote(leader: Listed, s: Listed, owner: Owner): string | null {
  const mine = s.record;
  if (!mine || mine.points - (leader.record?.points ?? 0) < RECORD_LEAD) return null;
  const theirs = leader.record;
  const who = owner ?? "You";
  if (!theirs) return `${who} ${owner ? "has" : "have"} won ${percent(mine)} of ${mine.games} games on ${s.name} and ${owner ? "has" : "have"} no games on ${leader.name}.`;
  if (mine.wins / mine.games <= theirs.wins / theirs.games) return null;
  return `${who} ${owner ? "wins" : "win"} more on ${s.name} (${percent(mine)} of ${mine.games} games) than on ${leader.name} (${percent(theirs)} of ${theirs.games}).`;
}

/** Scores this close read as level: below the 0.1 a card shows. */
const LEVEL = 0.05;

/**
 * A verdict per hero in `list` (best first, as shown). The first is the best pick, "clear" only when it beats
 * every other listed hero by more than their combined error. Every other hero says how far behind it is and
 * why; when the player wins more on it, its note says so, adding "A good pick too" when the gap is within the error.
 */
export function verdicts(list: Listed[], name: (id: number) => string, pos: Position, owner?: string): Verdict[] {
  const [leader, ...rest] = list;
  if (!leader) return [];
  if (!rest.length) return [{ heroId: leader.heroId, kind: "only", text: "The only hero on this list for this draft.", note: null }];
  const next = rest[0]!;
  const gap = leader.score - next.score;
  const clear = rest.every((s) => leader.score - s.score > marginOf(leader, s));
  const first: Verdict = clear
    ? {
        heroId: leader.heroId,
        kind: "clear",
        text: `${one(gap)} points ahead of ${next.name}, more than the ${one(marginOf(leader, next))} the data could be off by.`,
        note: null,
      }
    : gap < LEVEL
      ? { heroId: leader.heroId, kind: "best", text: `Level with ${next.name}, the next best.`, note: null }
      : { heroId: leader.heroId, kind: "best", text: `${one(gap)} points ahead of ${next.name}, the next best.`, note: null };
  return [
    first,
    ...rest.map((s): Verdict => {
      const behind = leader.score - s.score;
      const record = recordNote(leader, s, owner);
      const goodToo = record && behind <= marginOf(leader, s) && s.score > 0 ? " A good pick too." : "";
      const text = behind < LEVEL ? `Level with ${leader.name}.` : `${one(behind)} points behind ${leader.name}: ${whyBehind(leader, s, name, pos, owner)}.`;
      return { heroId: s.heroId, kind: "behind", text, note: record && `${record}${goodToo}` };
    }),
  ];
}
