import { mergeHardCounters } from "./data-hard-counters";
import { HARD_COUNTERS, hardCountersOf, type HardCounter } from "./hard-counters";
import { list, namedPoints, ordinal, pickLines, points, RANK_NAMES, ROLE_NAMES, summaryOf, type Line, type Warning } from "./reasons";
import { blindPickRisk, openSlots, pickChance } from "./risk";
import {
  FIT_FULL,
  FIT_ZERO,
  guessEnemyPositions,
  hasPositionCounts,
  knownPositions,
  LANE_OPPONENTS,
  positionFit,
  type PositionFit,
} from "./positions";
import { NEED_SHORT, traitsOf, unmetNeeds, type Need } from "./traits";
import type { PairWhy, PickWhy } from "./why";
import {
  phaseOf,
  POSITIONS,
  rankGroup,
  type DraftInput,
  type EnemyPositions,
  type HardCounterNote,
  type Position,
  type GamesWins,
  type HeroInfo,
  type PickPhase,
  type RankBracket,
  type RankGroup,
  type ScoreBreakdown,
  type ScoreWeights,
  type Snapshot,
  type Suggestion,
} from "./types";

/**
 * Every part of the score is in win-rate percentage points, so "+2.1" means
 * "about 2.1% more likely to win". The weights below turn softer signals
 * (position fit, team needs, comfort) into the same unit.
 */
const WEIGHTS = {
  /** Extra weight on an enemy you are likely to face in lane (0.5 = up to 1.5x). */
  laneOpponent: 0.5,
  /** Points for a perfect position fit compared with an average one. */
  positionFit: 10,
  /** Points per unmet team need the hero covers, once your team is complete. */
  teamNeed: 1.2,
  favorite: 1.5,
  /** Extra comfort for one of the user's Top 5 on this position, on top of `favorite`. Small on purpose. */
  top: 0.5,
  /** Share of the user's own win rate gap (after shrinking) that counts. */
  personal: 0.5,
  /** Points per extra position the hero can play, on the first pick. */
  flex: 0.6,
  /** Extra weight on the synergy with your lane partner (0.5 = 1.5x), when its position is known. */
  lanePartner: 0.5,
};

/** Every score part as the hand-set weights above make it. */
export const HAND_WEIGHTS: ScoreWeights = {
  counter: 1,
  synergy: 1,
  meta: 1,
  positionFit: 1,
  teamNeeds: 1,
  comfort: 1,
  flex: 1,
  pickSafety: 1,
};

/** Games of evidence a value is pulled toward its prior with (Bayesian shrinkage). */
const PRIOR_GAMES = { heroWinRate: 300, matchup: 250, rankMatchup: 250, personal: 15, pickPhase: 200 };

/**
 * Pick phase counts replace the matchup-based pick safety once the saved games behind them reach
 * this many. Fewer games would shrink every hero to 0 and lose the signal.
 */
const MIN_PICK_PHASE_GAMES = 3000;
const PHASE_NAMES = ["a first-round", "a second-round", "a last-round"];

/** The meta line names a hero's rank among those that fit the position, down to this place. */
const META_RANK_TOP = 10;
/** Games at the rank a hero needs to be ranked there. */
const META_RANK_GAMES = 500;
/** Share of a hero's games in the position for it to be ranked among that position's heroes. */
const META_RANK_FIT = 0.3;

/**
 * Players take a hard counter on purpose when they see its target, so the enemy is this many times
 * likelier to pick it than its usual pick rate says. A first guess, to be tuned with the backtest.
 */
const GAMBLE_PICK_BOOST = 2;

/** A matchup with fewer games than this says so on the card, since its number is mostly the prior. */
const FEW_MATCHUP_GAMES = 100;

/** Bans that lower a hero's blind pick risk by at least this many points are named as a reason. */
const BAN_LIFT_REASON = 0.3;
/** A hero this many points riskier than the other choices gets an "easy to punish" warning. */
const RISK_WARNING = 0.5;

/**
 * Share of an enemy's pos 4 plus pos 5 chance that counts as facing you in a lane with an enemy
 * support. At most 0.5, below the 0.5+ that names a hero "likely your lane".
 */
const SUPPORT_LANE_SHARE = 0.5;

/** Your lane partner's position, for each position. */
const LANE_PARTNER: Record<Position, Position | undefined> = { 1: 5, 2: undefined, 3: 4, 4: 3, 5: 1 };

/** A matchup or pairing smaller than this, in points, is never named on a card. */
const MATCHUP_NAME_MIN = 0.5;
/**
 * A matchup or pairing is named on a card ("Beats Tinker", "Works with Lich") only when it is above
 * this many standard errors: 1.645 is the one-sided 95% line, so a named one is real, not noise.
 * Smaller ones still count in the score, shrunk toward 0 by their few games.
 */
export const MATCHUP_NAME_Z = 1.645;

/** 1 for a matchup worth naming as won, -1 as lost, 0 when it is within noise or too small. */
export function clearMatchup({ edge, error }: { edge: number; error: number }): -1 | 0 | 1 {
  if (Math.abs(edge) < Math.max(MATCHUP_NAME_MIN, MATCHUP_NAME_Z * error)) return 0;
  return edge > 0 ? 1 : -1;
}

/** Heroes played in a position less often than this are not suggested for it. */
const MIN_POSITION_FIT = 0.15;
/** A position counts toward flexibility when the hero plays it at least this often. */
const FLEX_FIT = 0.2;

const shrink = (gw: GamesWins | undefined, prior: number, priorGames: number) =>
  gw ? (gw.wins + prior * priorGames) / (gw.games + priorGames) : prior;

/**
 * The standard error, in win-rate points, of a rate shrunk with `priorGames` from `games` games:
 * a 50% rate's binomial error with the prior counted as games. A matchup from 400 games is about
 * ±2 points either way, so two heroes whose scores differ by less than that are a coin flip.
 */
const errorPoints = (games: number, priorGames: number) => 50 / Math.sqrt(games + priorGames);

/** Precomputed lookups over a snapshot, built once and reused for every draft. */
export class Engine {
  readonly heroes: HeroInfo[];
  private fits = new Map<number, PositionFit>();
  /**
   * Each hero's record over its matchup row: all the public matches the matchup and synergy counts
   * come from, all ranks (key 0) and per rank group. Matchups are judged against this win rate and
   * not the heroStats one (a different, ranked-only and more recent sample), or a hero that wins
   * more in one sample than the other would look like it counters every enemy.
   */
  private rowTotals = new Map<RankGroup | 0, Map<number, GamesWins>>();
  private pickRates = new Map<number, number>();
  private hardCounters: Map<number, HardCounter[]>;
  /** True when the snapshot's pick phase counts hold enough games to score with. */
  private readonly usePickPhase: boolean;

  /** Multipliers on each score part: learned from saved games when the data has them, else all 1. */
  readonly partWeights: ScoreWeights;

  /**
   * `hardCounters` replaces the hand-checked list and the data's, for tests. `scoreWeights`
   * replaces the data's learned weights; null uses the hand-set weights alone.
   */
  constructor(
    readonly data: Snapshot,
    options: { hardCounters?: readonly HardCounter[]; scoreWeights?: ScoreWeights | null } = {},
  ) {
    this.partWeights = options.scoreWeights === undefined ? (data.scoreWeights?.weights ?? HAND_WEIGHTS) : (options.scoreWeights ?? HAND_WEIGHTS);
    // The hand-checked list plus the pairs found in the data; tests pass their own list instead.
    this.hardCounters = hardCountersOf(options.hardCounters ?? mergeHardCounters(HARD_COUNTERS, data.dataHardCounters));
    this.heroes = Object.values(data.heroes).sort((a, b) => a.id - b.id);
    for (const h of this.heroes) {
      this.fits.set(h.id, positionFit(h, data.laneRoles[h.id], data.positions?.[h.id]));
    }
    for (const group of [0, 1, 2, 3, 4] as const) {
      const rows = group ? data.rankMatchups?.[group] : data.matchups;
      this.rowTotals.set(group, new Map(this.heroes.map((h) => [h.id, totalOf(rows?.[h.id])])));
    }
    const picks = (id: number) => (data.bracketStats[id]?.picks ?? []).reduce((n, x) => n + x, 0);
    const games = this.heroes.reduce((n, h) => n + picks(h.id), 0) / 10;
    for (const h of this.heroes) this.pickRates.set(h.id, games > 0 ? picks(h.id) / games : 0);
    const phaseGames = Object.values(data.pickPhase ?? {}).reduce((n, r) => n + sum(r.games), 0) / 10;
    this.usePickPhase = phaseGames >= MIN_PICK_PHASE_GAMES;
  }

  hero(id: number): HeroInfo {
    const h = this.data.heroes[id];
    if (!h) throw new Error(`Unknown hero id ${id}`);
    return h;
  }

  fit(id: number): PositionFit {
    return this.fits.get(id)!;
  }

  /** Hero win rate at a rank bracket (1-8), or across all brackets. */
  winRate(id: number, bracket?: number): number {
    return this.winRateIn(id, bracket ? [bracket - 1] : undefined);
  }

  /** Hero win rate over the given bracket indexes (0 = Herald), or all of them. */
  private winRateIn(id: number, idx?: number[]): number {
    const s = this.data.bracketStats[id];
    if (!s) return 0.5;
    const use = idx ?? s.picks.map((_, i) => i);
    const games = use.reduce((n, i) => n + (s.picks[i] ?? 0), 0);
    const wins = use.reduce((n, i) => n + (s.wins[i] ?? 0), 0);
    return shrink({ games, wins }, 0.5, PRIOR_GAMES.heroWinRate);
  }

  /**
   * How much better hero a does against hero b than their overall win rates
   * predict, in percentage points. Positive means a counters b. With a rank
   * bracket, games at that rank group refine the all-ranks edge.
   */
  matchupEdge(a: number, b: number, bracket?: RankBracket): number {
    const group = bracket ? rankGroup(bracket) : undefined;
    const inGroup = group ? this.data.rankMatchups?.[group]?.[a]?.[b] : undefined;
    return this.edge(a, b, -1, this.data.matchups[a]?.[b], inGroup, group);
  }

  /** The standard error of matchupEdge(a, b), in points, from the all-ranks games behind it. */
  matchupError(a: number, b: number): number {
    return errorPoints(this.data.matchups[a]?.[b]?.games ?? 0, PRIOR_GAMES.matchup);
  }

  /** The standard error of synergyEdge(a, b), in points, from the all-ranks games behind it. */
  synergyError(a: number, b: number): number {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    return errorPoints(this.data.synergy[key]?.games ?? 0, PRIOR_GAMES.matchup);
  }

  /** The standard error of winRate(id, bracket), in points. */
  winRateError(id: number, bracket?: number): number {
    const s = this.data.bracketStats[id];
    const games = s ? (bracket ? (s.picks[bracket - 1] ?? 0) : s.picks.reduce((n, x) => n + x, 0)) : 0;
    return errorPoints(games, PRIOR_GAMES.heroWinRate);
  }

  /** How much better a and b do together than their overall win rates predict. */
  synergyEdge(a: number, b: number, bracket?: RankBracket): number {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const group = bracket ? rankGroup(bracket) : undefined;
    const inGroup = group ? this.data.rankSynergy?.[group]?.[key] : undefined;
    return this.edge(a, b, 1, this.data.synergy[key], inGroup, group);
  }

  /**
   * Shrinks the all-ranks record toward what the heroes' win rates in the same matches predict.
   * With a rank group, that group's record is then shrunk toward the
   * all-ranks edge, so a group with few games falls back to the all-ranks
   * number instead of to zero.
   */
  private edge(
    a: number,
    b: number,
    sign: 1 | -1,
    all: GamesWins | undefined,
    inGroup: GamesWins | undefined,
    group: RankGroup | undefined,
  ): number {
    // Against each other, each hero's win rate leaves out the games between them, so the matchup
    // itself does not move the number it is compared with.
    // Plain locals, not small helper functions: this runs for every pair of heroes in every
    // suggestion, and closures here made the backtest about 3 times slower under tsx.
    const withoutA = sign === -1 ? b : undefined;
    const withoutB = sign === -1 ? a : undefined;
    const wrA = this.sampleWinRate(a, withoutA, 0, 0.5);
    const wrB = this.sampleWinRate(b, withoutB, 0, 0.5);
    const expected = 0.5 + (wrA - 0.5) + sign * (wrB - 0.5);
    const edge = shrink(all, expected, PRIOR_GAMES.matchup) - expected;
    if (!group) return edge * 100;
    const groupA = this.sampleWinRate(a, withoutA, group, wrA);
    const groupB = this.sampleWinRate(b, withoutB, group, wrB);
    const groupExpected = 0.5 + (groupA - 0.5) + sign * (groupB - 0.5);
    return (shrink(inGroup, groupExpected + edge, PRIOR_GAMES.rankMatchup) - groupExpected) * 100;
  }

  /**
   * The numbers behind matchupEdge (sign -1) or synergyEdge (sign 1), before any lane weight: the games seen in the
   * rank group (all ranks without a rank), the win rate the two heroes' usual win rates predict, and the rate counted
   * after weighing few games. Mirrors `edge`, which stays lean because it runs for every pair; a test keeps them equal.
   */
  pairFacts(a: number, b: number, sign: 1 | -1, bracket?: RankBracket) {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const group = bracket ? rankGroup(bracket) : undefined;
    const all = sign === -1 ? this.data.matchups[a]?.[b] : this.data.synergy[key];
    const withoutA = sign === -1 ? b : undefined;
    const withoutB = sign === -1 ? a : undefined;
    const wrA = this.sampleWinRate(a, withoutA, 0, 0.5);
    const wrB = this.sampleWinRate(b, withoutB, 0, 0.5);
    const expected = 0.5 + (wrA - 0.5) + sign * (wrB - 0.5);
    const counted = shrink(all, expected, PRIOR_GAMES.matchup);
    if (!group) return { group: 0 as const, seen: all ?? null, allRanks: null, expected, counted, edge: (counted - expected) * 100 };
    const inGroup = sign === -1 ? this.data.rankMatchups?.[group]?.[a]?.[b] : this.data.rankSynergy?.[group]?.[key];
    const groupExpected =
      0.5 + (this.sampleWinRate(a, withoutA, group, wrA) - 0.5) + sign * (this.sampleWinRate(b, withoutB, group, wrB) - 0.5);
    const groupCounted = shrink(inGroup, groupExpected + (counted - expected), PRIOR_GAMES.rankMatchup);
    return {
      group,
      seen: inGroup ?? null,
      allRanks: all ?? null,
      expected: groupExpected,
      counted: groupCounted,
      edge: (groupCounted - groupExpected) * 100,
    };
  }

  /**
   * A hero's win rate over its matchup row (all ranks, or one rank group), leaving out the games
   * against `without`, shrunk toward `prior`. Every game is in the row once per enemy, so the
   * games are divided by 5 to weigh the record by real games.
   */
  private sampleWinRate(id: number, without: number | undefined, group: RankGroup | 0, prior: number): number {
    const total = this.rowTotals.get(group)?.get(id) ?? { games: 0, wins: 0 };
    const rows = group ? this.data.rankMatchups?.[group] : this.data.matchups;
    const left = without === undefined ? undefined : rows?.[id]?.[without];
    const games = (total.games - (left?.games ?? 0)) / 5;
    const wins = (total.wins - (left?.wins ?? 0)) / 5;
    return shrink(games > 0 ? { games, wins } : undefined, prior, PRIOR_GAMES.heroWinRate);
  }

  /**
   * How much better the hero does when its team picks it in this phase than over all its games,
   * in percentage points, or undefined when the snapshot has too few pick phase games.
   */
  pickPhaseEdge(id: number, phase: PickPhase): number | undefined {
    if (!this.usePickPhase) return undefined;
    const row = this.data.pickPhase?.[id];
    if (!row) return 0;
    const all = { games: sum(row.games), wins: sum(row.wins) };
    const overall = shrink(all, 0.5, PRIOR_GAMES.heroWinRate);
    const inPhase = { games: row.games[phase] ?? 0, wins: row.wins[phase] ?? 0 };
    return (shrink(inPhase, overall, PRIOR_GAMES.pickPhase) - overall) * 100;
  }

  /**
   * Chance (0-1) that each enemy is one you face in lane when playing `pos`. Which enemy support
   * is the 4 and which the 5 is often guessed wrong, and supports rotate, so in a lane with an
   * enemy support every likely support counts at least SUPPORT_LANE_SHARE of its support chance.
   * Enemies whose position the player set (`known`) are sure of it; a support still gets the floor, since it rotates.
   */
  laneChances(enemies: number[], pos: Position, known?: EnemyPositions): number[] {
    const facesSupport = LANE_OPPONENTS[pos].some((p) => p >= 4);
    return guessEnemyPositions(enemies.map((e) => this.fit(e)), knownPositions(enemies, known)).map((fit) => {
      const chance = LANE_OPPONENTS[pos].reduce((s, p) => s + fit[p], 0);
      return facesSupport ? Math.max(chance, SUPPORT_LANE_SHARE * (fit[4] + fit[5])) : chance;
    });
  }

  /** Points for how natural the hero is in a position, 0 for an average fit (FIT_ZERO), full from FIT_FULL. */
  positionScore(id: number, pos: Position): number {
    return WEIGHTS.positionFit * (Math.min(this.fit(id)[pos], FIT_FULL) - FIT_ZERO);
  }

  /** Share of games (0-1) the hero is picked in, by either team. */
  pickRate(id: number): number {
    return this.pickRates.get(id) ?? 0;
  }

  /**
   * Counter points against each enemy; likely lane opponents (from `laneChances`) count extra.
   * A hard counter on the enemy team costs at least its listed gap, so the match data and the
   * hand-checked list are never added up twice. `error` is the edge's standard error, weighted
   * the same way; 0 for a listed hard counter, which is checked rather than measured.
   */
  counterEdges(
    id: number,
    enemies: number[],
    laneChance: number[],
    bracket?: RankBracket,
  ): { enemy: number; edge: number; error: number; lane: boolean; hardGap: number | null }[] {
    const hard = this.hardCounters.get(id) ?? [];
    return enemies.map((enemy, i) => {
      const weight = 1 + WEIGHTS.laneOpponent * laneChance[i]!;
      const edge = this.matchupEdge(id, enemy, bracket) * weight;
      const gap = hard.find((hc) => hc.counter === enemy)?.gap;
      const lane = laneChance[i]! > 0.5;
      if (gap !== undefined && -gap < edge) return { enemy, edge: -gap, error: 0, lane, hardGap: gap };
      return { enemy, edge, error: this.matchupError(id, enemy) * weight, lane, hardGap: null };
    });
  }

  suggest(input: DraftInput): Suggestion[] {
    const pos = input.myPosition;
    const allyIds = input.allies.map((a) => a.heroId);
    const taken = new Set([...allyIds, ...input.enemies, ...(input.bans ?? [])]);
    const picksSoFar = allyIds.length + input.enemies.length;
    /** 1 on the first pick of the game, 0 on the last. */
    const earliness = Math.max(0, 1 - picksSoFar / 9);
    const favorites = new Set(input.favorites ?? []);
    // Top 5 only counts for heroes in the pool, so it can never lift a hero from outside it.
    const top = new Set((input.top ?? []).filter((id) => favorites.has(id)));

    const laneChance = this.laneChances(input.enemies, pos, input.enemyPositions);

    const allies = allyIds.map((id) => this.hero(id));
    const needs = unmetNeeds(allies);
    const needWeight = WEIGHTS.teamNeed * ((allies.length + 1) / 5);

    // Heroes the enemy can still pick, for judging how safe a pick is while they still have picks.
    const pool = this.heroes.filter((h) => !taken.has(h.id));
    const phase = phaseOf(allyIds.length);
    const candidates = pool.filter((h) => this.fit(h.id)[pos] >= MIN_POSITION_FIT || favorites.has(h.id));
    const risk = this.risks(candidates.map((h) => h.id), input);
    const avgRisk = mean([...risk.values()].map((r) => r.risk));
    const slots = openSlots(this, pool.map((h) => h.id), input.enemies, input.enemyPositions);
    const partner = LANE_PARTNER[pos];
    const metaRank = this.metaRanks(pos, input.rankBracket);
    const where = input.rankBracket ? ` at ${RANK_NAMES[input.rankBracket - 1]}` : "";

    const results: Suggestion[] = [];
    // The Why details of each candidate, built only for the heroes the list returns.
    const whys = new Map<number, () => PickWhy>();
    for (const hero of candidates) {
      const fit = this.fit(hero.id);

      const reasons: Line[] = [];
      const warnings: Warning[] = [];
      const tags: string[] = [];

      // Counters: how this hero does against the enemies already picked.
      const edges = this.counterEdges(hero.id, input.enemies, laneChance, input.rankBracket);
      const counter = edges.reduce((s, x) => s + x.edge, 0);
      const named = (xs: typeof edges) =>
        namedPoints(xs.map((x) => ({ name: this.hero(x.enemy).name, value: x.edge, note: this.matchupNote(hero.id, x.enemy, x.lane) })));
      const good = edges.filter((x) => clearMatchup(x) > 0);
      const bad = edges.filter((x) => clearMatchup(x) < 0);
      if (good.length) reasons.push({ text: `Beats ${named(good)}`, value: counter, kind: "draft" });
      if (bad.length) warnings.push({ text: `Loses to ${named(bad)}`, value: -Math.min(...bad.map((x) => x.edge)), matchup: true });

      // Synergy with the allies already picked; the lane partner counts extra.
      const synergies = input.allies.map(({ heroId: a, position }) => {
        const isPartner = partner !== undefined && position === partner;
        const weight = isPartner ? 1 + WEIGHTS.lanePartner : 1;
        const edge = this.synergyEdge(hero.id, a, input.rankBracket) * weight;
        const error = this.synergyError(hero.id, a) * weight;
        return { name: this.hero(a).name, value: edge, error, note: isPartner ? "your lane partner" : undefined, isPartner, weight };
      });
      const synergy = synergies.reduce((s, x) => s + x.value, 0);
      const friends = synergies.filter((x) => clearMatchup({ edge: x.value, error: x.error }) > 0);
      if (friends.length) reasons.push({ text: `Works with ${namedPoints(friends)}`, value: synergy, kind: "draft" });

      // Meta: the hero's win rate at the user's rank, and where that puts it for the position.
      const wr = this.winRate(hero.id, input.rankBracket);
      const meta = (wr - 0.5) * 100;
      const place = metaRank.get(hero.id);
      if (meta >= 1) {
        const text = place
          ? `${place === 1 ? "Best" : `${ordinal(place)} best`} ${ROLE_NAMES[pos]}${where}: ${(wr * 100).toFixed(1)}% win rate`
          : `Wins ${(wr * 100).toFixed(1)}% of games${where}`;
        reasons.push({ text, value: meta, kind: "base" });
      } else if (meta <= -2) warnings.push({ text: `Low win rate right now: ${(wr * 100).toFixed(1)}%${where}`, value: -meta });

      // Position fit: only heroes that fit are listed, so only a weak fit is worth a line.
      const positionScore = this.positionScore(hero.id, pos);
      if (fit[pos] < 0.2) warnings.push({ text: `Rarely played as ${ROLE_NAMES[pos]} (${Math.round(fit[pos] * 100)}% of games)`, value: -positionScore });

      // Team needs.
      const covered = needs.filter((n) => traitsOf(hero).has(n));
      const teamNeeds = covered.length * needWeight;
      if (covered.length && allies.length) {
        const text = `Adds what your team lacks: ${list(covered.slice(0, 3).map((n) => NEED_SHORT[n]))} (${points(teamNeeds)})`;
        reasons.push({ text, value: teamNeeds, kind: "draft" });
      }

      // Comfort: favorites and the user's own record on the hero, shown as tags.
      let comfort = 0;
      if (favorites.has(hero.id)) {
        comfort += WEIGHTS.favorite;
        tags.push(`Favorite (${points(WEIGHTS.favorite)})`);
      }
      if (top.has(hero.id)) {
        comfort += WEIGHTS.top;
        tags.push(`Top 5 (${points(WEIGHTS.top)})`);
      }
      const mine = input.personal?.[hero.id];
      let personal = 0;
      if (mine && mine.games > 0) {
        personal = personalScore(mine);
        comfort += personal;
        tags.push(`Your record ${mine.wins}-${mine.games - mine.wins} (${points(personal)})`);
      }

      // Flex: early on, a hero that fits several positions hides your plan.
      const otherPositions = POSITIONS.filter((p) => p !== pos && fit[p] >= FLEX_FIT);
      const flex = otherPositions.length * WEIGHTS.flex * earliness;
      if (flex >= 0.3) {
        const roles = list(otherPositions.map((p) => ROLE_NAMES[p]));
        reasons.push({ text: `Can also go ${roles}, so the enemy can't read your plan (${points(flex)})`, value: flex, kind: "base" });
      }

      // Pick safety: how much the hero stands to lose to the heroes the enemy may still pick,
      // compared with the other choices, so bans of its counters make it safer.
      const mineRisk = risk.get(hero.id);
      let pickSafety = mineRisk ? mineRisk.risk - avgRisk : 0;
      if (mineRisk && mineRisk.banLift >= BAN_LIFT_REASON) {
        const text = `Safer now: ${this.names(mineRisk.banned)} ${mineRisk.banned.length > 1 ? "are" : "is"} banned (${points(mineRisk.banLift)})`;
        reasons.push({ text, value: mineRisk.banLift, kind: "draft" });
      } else if (mineRisk && pickSafety >= RISK_WARNING) {
        const text = `Hard to punish: few heroes still open beat it (${points(pickSafety)})`;
        reasons.push({ text, value: pickSafety, kind: "draft" });
      }
      if (mineRisk && pickSafety <= -RISK_WARNING) {
        warnings.push({ text: `Easy to punish: ${this.names(mineRisk.threats)} can still be picked (${points(pickSafety)})`, value: -pickSafety });
      }

      // How the hero does when picked at this point of the draft, from the saved games.
      const phaseEdge = this.pickPhaseEdge(hero.id, phase);
      if (phaseEdge !== undefined) {
        pickSafety += phaseEdge;
        if (phaseEdge >= 1) reasons.push({ text: `Wins more as ${PHASE_NAMES[phase]} pick (${points(phaseEdge)})`, value: phaseEdge, kind: "draft" });
        else if (phaseEdge <= -1) {
          const text = `${phase === 0 ? "Easy to counter-pick later in the draft" : `Wins less as ${PHASE_NAMES[phase]} pick`} (${points(phaseEdge)})`;
          warnings.push({ text, value: -phaseEdge });
        }
      }

      // A hard counter still open is a gamble, costing its gap times the chance the enemy takes it.
      // A counter on the enemy team is already in the counter part, and neither is in the risk above.
      const hardCounters = this.hardCounterNotes(hero.id, input);
      const gambles: { heroId: number; gap: number; chance: number; cost: number }[] = [];
      for (const note of hardCounters) {
        if (note.status !== "open") continue;
        const chance = Math.min(1, pickChance(slots, note.counterId) * GAMBLE_PICK_BOOST);
        pickSafety -= note.gap * chance;
        gambles.push({ heroId: note.counterId, gap: note.gap, chance, cost: note.gap * chance });
      }

      const w = this.partWeights;
      const breakdown: ScoreBreakdown = {
        counter: round(counter * w.counter),
        synergy: round(synergy * w.synergy),
        meta: round(meta * w.meta),
        positionFit: round(positionScore * w.positionFit),
        teamNeeds: round(teamNeeds * w.teamNeeds),
        comfort: round(comfort * w.comfort),
        flex: round(flex * w.flex),
        pickSafety: round(pickSafety * w.pickSafety),
      };
      const score = round(Object.values(breakdown).reduce((s, x) => s + x, 0));
      // How far the data parts (counters, synergy, win rate) could be off: each part's error
      // weighted as it is in the score, added up as variances since they come from separate games.
      let variance = (this.winRateError(hero.id, input.rankBracket) * w.meta) ** 2;
      edges.forEach((x, i) => {
        variance += (this.matchupError(hero.id, x.enemy) * (1 + WEIGHTS.laneOpponent * laneChance[i]!) * w.counter) ** 2;
      });
      for (const { heroId: a, position } of input.allies) {
        const isPartner = partner !== undefined && position === partner;
        variance += (this.synergyError(hero.id, a) * (isPartner ? 1 + WEIGHTS.lanePartner : 1) * w.synergy) ** 2;
      }
      // The player's own record is a sample too: a hero they won 19 of 29 games on could be a 55% hero for them.
      const recordError = mine && mine.games > 0 ? personalError(mine) * w.comfort : 0;
      variance += recordError ** 2;
      const pair = (other: number, sign: 1 | -1, weight: number, part: number, points: number, error: number) => ({
        heroId: other,
        ...this.pairFacts(hero.id, other, sign, input.rankBracket),
        laneChance: 0,
        isPartner: false,
        weight,
        hardGap: null,
        points,
        error: round(error * part),
      });
      whys.set(hero.id, () => ({
        counters: edges.map((x, i): PairWhy => ({
          ...pair(x.enemy, -1, 1 + WEIGHTS.laneOpponent * laneChance[i]!, w.counter, round(x.edge * w.counter), x.error),
          laneChance: laneChance[i]!,
          hardGap: x.hardGap,
        })),
        synergy: input.allies.map(
          ({ heroId: a }, i): PairWhy => ({
            ...pair(a, 1, synergies[i]!.weight, w.synergy, round(synergies[i]!.value * w.synergy), synergies[i]!.error),
            isPartner: synergies[i]!.isPartner,
          }),
        ),
        meta: {
          seen: this.gamesAt(hero.id, input.rankBracket),
          bracket: input.rankBracket ?? null,
          rate: wr,
          place: place ?? null,
          points: breakdown.meta,
        },
        roleFit: {
          position: pos,
          share: fit[pos],
          isMeasured: hasPositionCounts(this.data.positions?.[hero.id]),
          zeroAt: FIT_ZERO,
          fullAt: FIT_FULL,
          maxPoints: round(WEIGHTS.positionFit * (FIT_FULL - FIT_ZERO) * w.positionFit),
          points: breakdown.positionFit,
        },
        teamNeeds: {
          needs: needs.map((need: Need) => ({ need, isCovered: covered.includes(need) })),
          allies: allies.length,
          each: round(needWeight * w.teamNeeds),
          points: breakdown.teamNeeds,
        },
        comfort: {
          favorite: favorites.has(hero.id) ? round(WEIGHTS.favorite * w.comfort) : 0,
          top: top.has(hero.id) ? round(WEIGHTS.top * w.comfort) : 0,
          record:
            mine && mine.games > 0
              ? { ...mine, counted: shrink(mine, 0.5, PRIOR_GAMES.personal), points: round(personal * w.comfort) }
              : null,
          points: breakdown.comfort,
        },
        flex: {
          positions: otherPositions.map((p) => ({ position: p, share: fit[p] })),
          picksSoFar,
          points: breakdown.flex,
        },
        pickSafety: {
          risk: round((mineRisk ? mineRisk.risk - avgRisk : 0) * w.pickSafety),
          threats: mineRisk?.threats ?? [],
          banned: mineRisk && mineRisk.banLift >= BAN_LIFT_REASON ? mineRisk.banned : [],
          banLift: round((mineRisk?.banLift ?? 0) * w.pickSafety),
          phase: phaseEdge === undefined ? null : round(phaseEdge * w.pickSafety),
          gambles: gambles.map((g) => ({ heroId: g.heroId, gap: g.gap, chance: g.chance, points: round(-g.cost * w.pickSafety) })),
          points: breakdown.pickSafety,
        },
        weights: w,
      }));
      results.push({
        heroId: hero.id,
        name: hero.name,
        score,
        error: round(Math.sqrt(variance)),
        breakdown,
        counterBy: edges.map((x) => ({ heroId: x.enemy, points: round(x.edge * w.counter) })),
        synergyBy: input.allies.map((a, i) => ({ heroId: a.heroId, points: round(synergies[i]!.value * w.synergy) })),
        record: mine && mine.games > 0 ? { points: round(personal * w.comfort), error: round(recordError), games: mine.games, wins: mine.wins } : null,
        reasons: pickLines(reasons, warnings),
        summary: summaryOf(breakdown),
        place: { rank: 0, of: 0 },
        tags,
        hardCounters,
      });
    }

    // Every hero's place among all the heroes scored for the position, before the list is cut, so
    // a card can say "31st of 52" with the same score it shows.
    results.sort((a, b) => b.score - a.score);
    results.forEach((s, i) => {
      s.place = { rank: i + 1, of: results.length };
      s.summary = summaryOf(s.breakdown, { ...s.place, pos });
    });
    const shown = results.slice(0, input.count ?? 8);
    for (const s of shown) s.why = whys.get(s.heroId)!(); // Every result has one.
    return shown;
  }

  /** The hero's games and wins at a rank bracket (1-8), or over all of them. */
  private gamesAt(id: number, bracket?: RankBracket): GamesWins {
    const s = this.data.bracketStats[id];
    if (!s) return { games: 0, wins: 0 };
    const use = bracket ? [bracket - 1] : s.picks.map((_, i) => i);
    return { games: sum(use.map((i) => s.picks[i] ?? 0)), wins: sum(use.map((i) => s.wins[i] ?? 0)) };
  }

  /** "likely your lane", "only 56 games" or both, for a matchup named on a card. */
  private matchupNote(hero: number, enemy: number, lane: boolean): string | undefined {
    const games = this.data.matchups[hero]?.[enemy]?.games ?? 0;
    const notes = [lane ? "likely your lane" : "", games < FEW_MATCHUP_GAMES ? `only ${Math.round(games)} games` : ""];
    return notes.filter(Boolean).join(", ") || undefined;
  }

  /**
   * Each hero's place by win rate at the rank among the heroes mostly played in the position with
   * enough games there, for the top META_RANK_TOP. Heroes rarely played there get no place.
   */
  private metaRanks(pos: Position, bracket?: RankBracket): Map<number, number> {
    const games = (id: number) => {
      const picks = this.data.bracketStats[id]?.picks ?? [];
      return bracket ? (picks[bracket - 1] ?? 0) : picks.reduce((s, x) => s + x, 0);
    };
    const ranked = this.heroes
      .filter((h) => this.fit(h.id)[pos] >= META_RANK_FIT && games(h.id) >= META_RANK_GAMES)
      .map((h) => ({ id: h.id, wr: this.winRate(h.id, bracket) }))
      .sort((a, b) => b.wr - a.wr)
      .slice(0, META_RANK_TOP);
    return new Map(ranked.map((h, i) => [h.id, i + 1]));
  }

  /**
   * Where each hand-checked hard counter of a hero stands in the draft: on the enemy team, still
   * open while the enemy has picks left, or out (banned or on your team). A counter that can no
   * longer be picked by anyone is left out.
   */
  hardCounterNotes(heroId: number, draft: Pick<DraftInput, "allies" | "enemies" | "bans">): HardCounterNote[] {
    const notes: HardCounterNote[] = [];
    for (const hc of this.hardCounters.get(heroId) ?? []) {
      const name = this.hero(hc.counter).name;
      const out = (draft.bans ?? []).includes(hc.counter) || draft.allies.some((a) => a.heroId === hc.counter);
      if (draft.enemies.includes(hc.counter)) {
        notes.push({ counterId: hc.counter, gap: hc.gap, status: "enemy", text: `Hard countered: ${name} is on the enemy team` });
      } else if (out) {
        notes.push({ counterId: hc.counter, gap: hc.gap, status: "out", text: `${name} is out, safe to pick` });
      } else if (draft.enemies.length < 5) {
        notes.push({ counterId: hc.counter, gap: hc.gap, status: "open", text: `Gamble: ${name} still available` });
      }
    }
    return notes;
  }

  /**
   * Blind pick risk of each candidate (see risk.ts), how much the bans lowered it and by which
   * banned heroes, and the two heroes it is most at risk from. Hard counters are left out: the
   * gamble counts them.
   */
  private risks(candidates: number[], input: DraftInput) {
    const picked = new Set([...input.allies.map((a) => a.heroId), ...input.enemies]);
    const bans = new Set((input.bans ?? []).filter((id) => !picked.has(id)));
    const unpicked = this.heroes.map((h) => h.id).filter((id) => !picked.has(id));
    const skip = new Set(candidates.flatMap((c) => (this.hardCounters.get(c) ?? []).map((hc) => `${c}-${hc.counter}`)));
    const base = {
      candidates,
      enemies: input.enemies,
      enemyPositions: input.enemyPositions,
      myPosition: input.myPosition,
      rankBracket: input.rankBracket,
      skip,
    };
    const now = blindPickRisk(this, { ...base, pool: unpicked.filter((id) => !bans.has(id)) });
    const unbanned = bans.size ? blindPickRisk(this, { ...base, pool: unpicked }) : now;
    const top = (by: Map<number, number>, n: number, keep: (id: number) => boolean) =>
      [...by].filter(([id]) => keep(id)).sort((x, y) => x[1] - y[1]).slice(0, n).map(([id]) => id);
    return new Map(
      candidates.map((c) => {
        const r = now.get(c)!; // Every candidate was scored.
        const before = unbanned.get(c)!;
        return [c, { risk: r.risk, banLift: r.risk - before.risk, banned: top(before.by, 2, (id) => bans.has(id)), threats: top(r.by, 2, () => true) }];
      }),
    );
  }

  names(ids: number[]): string {
    const names = ids.slice(0, 3).map((id) => this.hero(id).name);
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
  }
}

/** Points for the user's own record on a hero, after shrinking small samples. */
export const personalScore = (mine: GamesWins) => (shrink(mine, 0.5, PRIOR_GAMES.personal) - 0.5) * 100 * WEIGHTS.personal;

/**
 * How far `personalScore` could be off, in the same points: the binomial error of the record around its shrunk
 * rate, shrunk the same way. A 10-0 record still has an error, since its shrunk rate is not 100%.
 */
export function personalError(mine: GamesWins): number {
  const p = shrink(mine, 0.5, PRIOR_GAMES.personal);
  return (Math.sqrt(mine.games * p * (1 - p)) / (mine.games + PRIOR_GAMES.personal)) * 100 * WEIGHTS.personal;
}

/** Games and wins summed over a matchup row. */
function totalOf(row: Record<string, GamesWins> | undefined): GamesWins {
  let games = 0;
  let wins = 0;
  for (const r of Object.values(row ?? {})) {
    games += r.games;
    wins += r.wins;
  }
  return { games, wins };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round = (x: number) => Math.round(x * 100) / 100;

export function suggest(data: Snapshot, input: DraftInput): Suggestion[] {
  return new Engine(data).suggest(input);
}
