import { hardCountersOf, type HardCounter } from "./hard-counters";
import { blindPickRisk, openSlots, pickChance } from "./risk";
import { guessEnemyPositions, LANE_OPPONENTS, positionFit, type PositionFit } from "./positions";
import { NEED_LABELS, traitsOf, unmetNeeds } from "./traits";
import {
  phaseOf,
  POSITIONS,
  RANK_GROUP_BRACKETS,
  rankGroup,
  type DraftInput,
  type HardCounterNote,
  type Position,
  type GamesWins,
  type HeroInfo,
  type PickPhase,
  type RankBracket,
  type RankGroup,
  type ScoreBreakdown,
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
  /** Share of the user's own win rate gap (after shrinking) that counts. */
  personal: 0.5,
  /** Points per extra position the hero can play, on the first pick. */
  flex: 0.6,
  /** Extra weight on the synergy with your lane partner (0.5 = 1.5x), when its position is known. */
  lanePartner: 0.5,
};

/** Games of evidence a value is pulled toward its prior with (Bayesian shrinkage). */
const PRIOR_GAMES = { heroWinRate: 300, matchup: 250, rankMatchup: 250, personal: 15, pickPhase: 200 };

/**
 * Pick phase counts replace the matchup-based pick safety once the saved games behind them reach
 * this many. Fewer games would shrink every hero to 0 and lose the signal.
 */
const MIN_PICK_PHASE_GAMES = 3000;
const PHASE_NAMES = ["an early", "a 3rd", "a late"];

/**
 * Players take a hard counter on purpose when they see its target, so the enemy is this many times
 * likelier to pick it than its usual pick rate says. A first guess, to be tuned with the backtest.
 */
const GAMBLE_PICK_BOOST = 2;

/** Bans that lower a hero's blind pick risk by at least this many points are named as a reason. */
const BAN_LIFT_REASON = 0.3;
/** A hero this many points riskier than the other choices gets an "easy to punish" warning. */
const RISK_WARNING = 0.5;

/** Your lane partner's position, for each position. */
const LANE_PARTNER: Record<Position, Position | undefined> = { 1: 5, 2: undefined, 3: 4, 4: 3, 5: 1 };

/** Heroes played in a position less often than this are not suggested for it. */
const MIN_POSITION_FIT = 0.15;
/** A position counts toward flexibility when the hero plays it at least this often. */
const FLEX_FIT = 0.2;

const shrink = (gw: GamesWins | undefined, prior: number, priorGames: number) =>
  gw ? (gw.wins + prior * priorGames) / (gw.games + priorGames) : prior;

const RANK_NAMES = ["Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];

/** Precomputed lookups over a snapshot, built once and reused for every draft. */
export class Engine {
  readonly heroes: HeroInfo[];
  private fits = new Map<number, PositionFit>();
  private overallWr = new Map<number, number>();
  private pickRates = new Map<number, number>();
  private hardCounters: Map<number, HardCounter[]>;
  /** True when the snapshot's pick phase counts hold enough games to score with. */
  private readonly usePickPhase: boolean;

  /** `hardCounters` replaces the hand-checked list, for tests. */
  constructor(
    readonly data: Snapshot,
    options: { hardCounters?: readonly HardCounter[] } = {},
  ) {
    this.hardCounters = hardCountersOf(options.hardCounters);
    this.heroes = Object.values(data.heroes).sort((a, b) => a.id - b.id);
    for (const h of this.heroes) {
      this.fits.set(h.id, positionFit(h, data.laneRoles[h.id], data.positions?.[h.id]));
      this.overallWr.set(h.id, this.winRate(h.id));
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

  /** How much better a and b do together than their overall win rates predict. */
  synergyEdge(a: number, b: number, bracket?: RankBracket): number {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const group = bracket ? rankGroup(bracket) : undefined;
    const inGroup = group ? this.data.rankSynergy?.[group]?.[key] : undefined;
    return this.edge(a, b, 1, this.data.synergy[key], inGroup, group);
  }

  /**
   * Shrinks the all-ranks record toward what the heroes' win rates predict.
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
    const expected = 0.5 + (this.overallWr.get(a)! - 0.5) + sign * (this.overallWr.get(b)! - 0.5);
    const edge = shrink(all, expected, PRIOR_GAMES.matchup) - expected;
    if (!group) return edge * 100;
    const idx = RANK_GROUP_BRACKETS[group].map((r) => r - 1);
    const groupExpected = 0.5 + (this.winRateIn(a, idx) - 0.5) + sign * (this.winRateIn(b, idx) - 0.5);
    return (shrink(inGroup, groupExpected + edge, PRIOR_GAMES.rankMatchup) - groupExpected) * 100;
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

  /** Chance (0-1) that each enemy is one you face in lane when playing `pos`. */
  laneChances(enemies: number[], pos: Position): number[] {
    return guessEnemyPositions(enemies.map((e) => this.fit(e))).map((fit) =>
      LANE_OPPONENTS[pos].reduce((s, p) => s + fit[p], 0),
    );
  }

  /** Points for how natural the hero is in a position, 0 for an average fit. */
  positionScore(id: number, pos: Position): number {
    return WEIGHTS.positionFit * (Math.min(this.fit(id)[pos], 0.6) - 0.3);
  }

  /** Share of games (0-1) the hero is picked in, by either team. */
  pickRate(id: number): number {
    return this.pickRates.get(id) ?? 0;
  }

  /**
   * Counter points against each enemy; likely lane opponents (from `laneChances`) count extra.
   * A hard counter on the enemy team costs at least its listed gap, so the match data and the
   * hand-checked list are never added up twice.
   */
  counterEdges(
    id: number,
    enemies: number[],
    laneChance: number[],
    bracket?: RankBracket,
  ): { enemy: number; edge: number; lane: boolean }[] {
    const hard = this.hardCounters.get(id) ?? [];
    return enemies.map((enemy, i) => {
      const edge = this.matchupEdge(id, enemy, bracket) * (1 + WEIGHTS.laneOpponent * laneChance[i]!);
      const gap = hard.find((hc) => hc.counter === enemy)?.gap;
      return { enemy, edge: gap === undefined ? edge : Math.min(edge, -gap), lane: laneChance[i]! > 0.5 };
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

    const laneChance = this.laneChances(input.enemies, pos);

    const allies = allyIds.map((id) => this.hero(id));
    const needs = unmetNeeds(allies);
    const needWeight = WEIGHTS.teamNeed * ((allies.length + 1) / 5);

    // Heroes the enemy can still pick, for judging how safe a pick is while they still have picks.
    const pool = this.heroes.filter((h) => !taken.has(h.id));
    const phase = phaseOf(allyIds.length);
    const candidates = pool.filter((h) => this.fit(h.id)[pos] >= MIN_POSITION_FIT || favorites.has(h.id));
    const risk = this.risks(candidates.map((h) => h.id), input);
    const avgRisk = mean([...risk.values()].map((r) => r.risk));
    const slots = openSlots(this, pool.map((h) => h.id), input.enemies);
    const partner = LANE_PARTNER[pos];

    const results: Suggestion[] = [];
    for (const hero of candidates) {
      const fit = this.fit(hero.id);

      const reasons: { text: string; value: number }[] = [];
      const warnings: { text: string; value: number }[] = [];

      // Counters: how this hero does against the enemies already picked.
      const edges = this.counterEdges(hero.id, input.enemies, laneChance, input.rankBracket);
      const counter = edges.reduce((s, x) => s + x.edge, 0);
      const good = edges.filter((x) => x.edge >= 0.5).sort((a, b) => b.edge - a.edge);
      const bad = edges.filter((x) => x.edge <= -0.5).sort((a, b) => a.edge - b.edge);
      if (good.length) {
        const lane = good.some((x) => x.lane) ? " (including your likely lane opponent)" : "";
        reasons.push({ text: `Strong against ${this.names(good.map((x) => x.enemy))}${lane}`, value: counter });
      }
      if (bad.length) {
        warnings.push({ text: `Struggles against ${this.names(bad.map((x) => x.enemy))}`, value: -bad[0]!.edge });
      }

      // Synergy with the allies already picked.
      let synergy = 0;
      const synergies = input.allies.map(({ heroId: a, position }) => {
        const lanePartner = partner !== undefined && position === partner ? 1 + WEIGHTS.lanePartner : 1;
        return { a, edge: this.synergyEdge(hero.id, a, input.rankBracket) * lanePartner };
      });
      for (const s of synergies) synergy += s.edge;
      const friends = synergies.filter((s) => s.edge >= 0.5).sort((a, b) => b.edge - a.edge);
      if (friends.length) reasons.push({ text: `Works well with ${this.names(friends.map((s) => s.a))}`, value: synergy });

      // Meta: the hero's win rate at the user's rank.
      const wr = this.winRate(hero.id, input.rankBracket);
      const meta = (wr - 0.5) * 100;
      const where = input.rankBracket ? ` in ${RANK_NAMES[input.rankBracket - 1]}` : "";
      if (meta >= 1) reasons.push({ text: `Strong in the current meta: ${(wr * 100).toFixed(1)}% win rate${where}`, value: meta });
      else if (meta <= -2) warnings.push({ text: `Low win rate right now: ${(wr * 100).toFixed(1)}%${where}`, value: -meta });

      // Position fit.
      const positionScore = this.positionScore(hero.id, pos);
      if (fit[pos] >= 0.5) reasons.push({ text: `A natural pos ${pos} (${Math.round(fit[pos] * 100)}% of games)`, value: positionScore });
      else if (fit[pos] < 0.2) warnings.push({ text: `Rarely played as pos ${pos}`, value: -positionScore });

      // Team needs.
      const covered = needs.filter((n) => traitsOf(hero).has(n));
      const teamNeeds = covered.length * needWeight;
      if (covered.length && allies.length) reasons.push({ text: capitalize(covered.map((n) => NEED_LABELS[n]).join(", ")), value: teamNeeds });

      // Comfort: favorites and the user's own record on the hero.
      let comfort = 0;
      if (favorites.has(hero.id)) {
        comfort += WEIGHTS.favorite;
        reasons.push({ text: "One of your favorite heroes", value: WEIGHTS.favorite });
      }
      const mine = input.personal?.[hero.id];
      if (mine && mine.games > 0) {
        const personal = personalScore(mine);
        comfort += personal;
        const text = `You have won ${mine.wins} of ${mine.games} games on this hero`;
        if (personal >= 0.5) reasons.push({ text, value: personal });
        else if (personal <= -0.5) warnings.push({ text, value: -personal });
      }

      // Flex: early on, a hero that fits several positions hides your plan.
      const otherPositions = POSITIONS.filter((p) => p !== pos && fit[p] >= FLEX_FIT);
      const flex = otherPositions.length * WEIGHTS.flex * earliness;
      if (flex >= 0.3) reasons.push({ text: `Flexible pick: can also play pos ${otherPositions.join(" or ")}`, value: flex });

      // Pick safety: how much the hero stands to lose to the heroes the enemy may still pick,
      // compared with the other choices, so bans of its counters make it safer.
      const mineRisk = risk.get(hero.id);
      let pickSafety = mineRisk ? mineRisk.risk - avgRisk : 0;
      if (mineRisk && mineRisk.banLift >= BAN_LIFT_REASON) {
        reasons.push({ text: `Safer now: ${this.names(mineRisk.banned)} ${mineRisk.banned.length > 1 ? "are" : "is"} banned`, value: mineRisk.banLift });
      }
      if (mineRisk && pickSafety <= -RISK_WARNING) {
        warnings.push({ text: `Easy to punish: ${this.names(mineRisk.threats)} can still be picked`, value: -pickSafety });
      }

      // How the hero does when picked at this point of the draft, from the saved games.
      const phaseEdge = this.pickPhaseEdge(hero.id, phase);
      if (phaseEdge !== undefined) {
        pickSafety += phaseEdge;
        if (phaseEdge >= 1) reasons.push({ text: `Wins more as ${PHASE_NAMES[phase]} pick`, value: phaseEdge });
        else if (phaseEdge <= -1) {
          const text = phase === 0 ? "Easy to counter-pick later in the draft" : `Wins less as ${PHASE_NAMES[phase]} pick`;
          warnings.push({ text, value: -phaseEdge });
        }
      }

      // A hard counter still open is a gamble, costing its gap times the chance the enemy takes it.
      // A counter on the enemy team is already in the counter part, and neither is in the risk above.
      const hardCounters = this.hardCounterNotes(hero.id, input);
      for (const note of hardCounters) {
        if (note.status !== "open") continue;
        pickSafety -= note.gap * Math.min(1, pickChance(slots, note.counterId) * GAMBLE_PICK_BOOST);
      }

      const breakdown: ScoreBreakdown = {
        counter: round(counter),
        synergy: round(synergy),
        meta: round(meta),
        positionFit: round(positionScore),
        teamNeeds: round(teamNeeds),
        comfort: round(comfort),
        flex: round(flex),
        pickSafety: round(pickSafety),
      };
      const score = round(Object.values(breakdown).reduce((s, x) => s + x, 0));
      const top = reasons.sort((a, b) => b.value - a.value).slice(0, 3).map((r) => r.text);
      const warn = warnings
        .sort((a, b) => b.value - a.value)
        .slice(0, 1)
        .map((w) => `Watch out: ${w.text.charAt(0).toLowerCase()}${w.text.slice(1)}`);
      results.push({ heroId: hero.id, name: hero.name, score, breakdown, reasons: [...top, ...warn], hardCounters });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, input.count ?? 8);
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
    const base = { candidates, enemies: input.enemies, myPosition: input.myPosition, rankBracket: input.rankBracket, skip };
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

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round = (x: number) => Math.round(x * 100) / 100;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function suggest(data: Snapshot, input: DraftInput): Suggestion[] {
  return new Engine(data).suggest(input);
}
