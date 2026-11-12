/**
 * The numbers behind every part of a pick's score, for the Why details a card opens: the games each matchup and
 * pairing comes from, the win rate the two heroes' usual win rates predict, what is counted after weighing few
 * games, the lane weight, and the inputs of the other parts. Built only for the heroes a list returns.
 */
import type { Need } from "./traits";
import type { GamesWins, Position, RankBracket, RankGroup, ScoreWeights } from "./types";

/** A matchup (counters) or pairing (synergy) and how its games become points. */
export interface PairWhy {
  /** The enemy or ally. */
  heroId: number;
  /** Rank group the seen games are from (0 = all ranks, used when no rank is set). */
  group: RankGroup | 0;
  /** Games and wins of the two heroes against (or with) each other in that group; null with none. */
  seen: GamesWins | null;
  /** The same over all ranks, which few games in the group are pulled toward; null without a rank. */
  allRanks: GamesWins | null;
  /** Win rate (0 to 1) the two heroes' usual win rates predict for the pair, in the same games. */
  expected: number;
  /** Win rate (0 to 1) counted after weighing the seen games against the prior. */
  counted: number;
  /** Win-rate points, counted minus expected, before the lane weight. */
  edge: number;
  /** Chance (0 to 1) the enemy is in your lane, for counters; 0 for synergy. */
  laneChance: number;
  /** True for the ally who is your lane partner. */
  isPartner: boolean;
  /** The multiplier on `edge`: up to 1.5 for a lane opponent, 1.5 for the lane partner, else 1. */
  weight: number;
  /** A listed hard counter on the enemy team: its points are at least this many lost, not the games. */
  hardGap: number | null;
  /** Score points, `edge` x `weight` x the part's weight (or minus `hardGap`). */
  points: number;
  /** How far the points could be off, from the games behind them. */
  error: number;
}

export interface MetaWhy {
  /** The hero's games and wins at the rank (all ranks without one). */
  seen: GamesWins;
  bracket: RankBracket | null;
  /** Win rate (0 to 1) after weighing few games. */
  rate: number;
  /** Place by win rate among the heroes mostly played in the position, when in the top 10. */
  place: number | null;
  points: number;
}

export interface RoleFitWhy {
  position: Position;
  /** Share (0 to 1) of the hero's games in the position. */
  share: number;
  /** True when the share comes from position counts, false when guessed from lanes and roles. */
  isMeasured: boolean;
  /** The share that gives 0 points and the share that gives full points. */
  zeroAt: number;
  fullAt: number;
  /** Points at `fullAt` and above. */
  maxPoints: number;
  points: number;
}

export interface TeamNeedsWhy {
  /** Every need your team had before this pick, and whether the hero covers it. */
  needs: { need: Need; isCovered: boolean }[];
  /** Your team's picks so far; each need counts more as the team fills. */
  allies: number;
  /** Points per covered need at this many picks. */
  each: number;
  points: number;
}

export interface ComfortWhy {
  favorite: number;
  top: number;
  /** The player's games and wins on the hero, the rate counted after weighing few games, and its points. */
  record: (GamesWins & { counted: number; points: number }) | null;
  points: number;
}

export interface FlexWhy {
  /** The other positions the hero is played in often enough, with its share of games there. */
  positions: { position: Position; share: number }[];
  /** Picks made so far in the game; flex counts less the later the pick. */
  picksSoFar: number;
  points: number;
}

export interface PickSafetyWhy {
  /** Points from the heroes the enemy can still pick against the average choice (minus = riskier). */
  risk: number;
  /** The open heroes that hurt it most. */
  threats: number[];
  /** Bans that made it safer, and by how much. */
  banned: number[];
  banLift: number;
  /** Points from how the hero does when picked at this point of the draft; null without the data. */
  phase: number | null;
  /** Hard counters the enemy can still pick: the points each costs, its gap and the chance they take it. */
  gambles: { heroId: number; gap: number; chance: number; points: number }[];
  points: number;
}

export interface PickWhy {
  counters: PairWhy[];
  synergy: PairWhy[];
  meta: MetaWhy;
  roleFit: RoleFitWhy;
  teamNeeds: TeamNeedsWhy;
  comfort: ComfortWhy;
  flex: FlexWhy;
  pickSafety: PickSafetyWhy;
  /** The learned multiplier on each part (all 1 with the hand-set weights), already in every number above. */
  weights: ScoreWeights;
}
