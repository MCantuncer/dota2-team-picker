import { guessEnemyPositions, LANE_OPPONENTS, positionFit, type PositionFit } from "./positions";
import { NEED_LABELS, traitsOf, unmetNeeds } from "./traits";
import {
  POSITIONS,
  type DraftInput,
  type GamesWins,
  type HeroInfo,
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
  /** How much the worst counters still in the pool hurt, on the first pick. */
  pickSafety: 0.5,
};

/** Games of evidence a value is pulled toward its prior with (Bayesian shrinkage). */
const PRIOR_GAMES = { heroWinRate: 300, matchup: 250, personal: 15 };

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

  constructor(readonly data: Snapshot) {
    this.heroes = Object.values(data.heroes).sort((a, b) => a.id - b.id);
    for (const h of this.heroes) {
      this.fits.set(h.id, positionFit(h, data.laneRoles[h.id]));
      this.overallWr.set(h.id, this.winRate(h.id));
    }
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
    const s = this.data.bracketStats[id];
    if (!s) return 0.5;
    const idx = bracket ? [bracket - 1] : s.picks.map((_, i) => i);
    const games = idx.reduce((n, i) => n + (s.picks[i] ?? 0), 0);
    const wins = idx.reduce((n, i) => n + (s.wins[i] ?? 0), 0);
    return shrink({ games, wins }, 0.5, PRIOR_GAMES.heroWinRate);
  }

  /**
   * How much better hero a does against hero b than their overall win rates
   * predict, in percentage points. Positive means a counters b.
   */
  matchupEdge(a: number, b: number): number {
    const expected = 0.5 + (this.overallWr.get(a)! - 0.5) - (this.overallWr.get(b)! - 0.5);
    const gw = this.data.matchups[a]?.[b];
    return (shrink(gw, expected, PRIOR_GAMES.matchup) - expected) * 100;
  }

  /** How much better a and b do together than their overall win rates predict. */
  synergyEdge(a: number, b: number): number {
    const expected = 0.5 + (this.overallWr.get(a)! - 0.5) + (this.overallWr.get(b)! - 0.5);
    const gw = this.data.synergy[a < b ? `${a}-${b}` : `${b}-${a}`];
    return (shrink(gw, expected, PRIOR_GAMES.matchup) - expected) * 100;
  }

  suggest(input: DraftInput): Suggestion[] {
    const pos = input.myPosition;
    const allyIds = input.allies.map((a) => a.heroId);
    const taken = new Set([...allyIds, ...input.enemies, ...(input.bans ?? [])]);
    const picksSoFar = allyIds.length + input.enemies.length;
    /** 1 on the first pick of the game, 0 on the last. */
    const earliness = Math.max(0, 1 - picksSoFar / 9);
    const favorites = new Set(input.favorites ?? []);

    const enemyPositions = guessEnemyPositions(input.enemies.map((e) => this.fit(e)));
    const laneChance = enemyPositions.map((fit) => LANE_OPPONENTS[pos].reduce((s, p) => s + fit[p], 0));

    const allies = allyIds.map((id) => this.hero(id));
    const needs = unmetNeeds(allies);
    const needWeight = WEIGHTS.teamNeed * ((allies.length + 1) / 5);

    // Heroes the enemy can still pick, for judging how safe an early pick is.
    const pool = this.heroes.filter((h) => !taken.has(h.id));
    const enemySlotsLeft = 5 - input.enemies.length;
    const vulnerability = this.vulnerability(pool);
    const avgVulnerability = mean([...vulnerability.values()]);

    const results: Suggestion[] = [];
    for (const hero of pool) {
      const fit = this.fit(hero.id);
      if (fit[pos] < MIN_POSITION_FIT && !favorites.has(hero.id)) continue;

      const reasons: { text: string; value: number }[] = [];
      const warnings: { text: string; value: number }[] = [];

      // Counters: how this hero does against the enemies already picked.
      let counter = 0;
      const edges = input.enemies.map((e, i) => {
        const edge = this.matchupEdge(hero.id, e) * (1 + WEIGHTS.laneOpponent * laneChance[i]!);
        counter += edge;
        return { e, edge, lane: laneChance[i]! > 0.5 };
      });
      const good = edges.filter((x) => x.edge >= 0.5).sort((a, b) => b.edge - a.edge);
      const bad = edges.filter((x) => x.edge <= -0.5).sort((a, b) => a.edge - b.edge);
      if (good.length) {
        const lane = good.some((x) => x.lane) ? " (including your likely lane opponent)" : "";
        reasons.push({ text: `Strong against ${this.names(good.map((x) => x.e))}${lane}`, value: counter });
      }
      if (bad.length) {
        warnings.push({ text: `Struggles against ${this.names(bad.map((x) => x.e))}`, value: -bad[0]!.edge });
      }

      // Synergy with the allies already picked.
      let synergy = 0;
      const synergies = allyIds.map((a) => ({ a, edge: this.synergyEdge(hero.id, a) }));
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
      const positionScore = WEIGHTS.positionFit * (Math.min(fit[pos], 0.6) - 0.3);
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
        const personal = (shrink(mine, 0.5, PRIOR_GAMES.personal) - 0.5) * 100 * WEIGHTS.personal;
        comfort += personal;
        const text = `You have won ${mine.wins} of ${mine.games} games on this hero`;
        if (personal >= 0.5) reasons.push({ text, value: personal });
        else if (personal <= -0.5) warnings.push({ text, value: -personal });
      }

      // Flex: early on, a hero that fits several positions hides your plan.
      const otherPositions = POSITIONS.filter((p) => p !== pos && fit[p] >= FLEX_FIT);
      const flex = otherPositions.length * WEIGHTS.flex * earliness;
      if (flex >= 0.3) reasons.push({ text: `Flexible pick: can also play pos ${otherPositions.join(" or ")}`, value: flex });

      // Pick safety: early on, how hard the enemy can still counter this hero.
      let pickSafety = 0;
      if (enemySlotsLeft > 0 && earliness > 0) {
        const relative = vulnerability.get(hero.id)! - avgVulnerability;
        pickSafety = relative * WEIGHTS.pickSafety * earliness * (enemySlotsLeft / 5);
        if (pickSafety <= -1) warnings.push({ text: "Easy to counter-pick later in the draft", value: -pickSafety });
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
      const warn = warnings.sort((a, b) => b.value - a.value).slice(0, 1).map((w) => `Watch out: ${w.text.charAt(0).toLowerCase()}${w.text.slice(1)}`);
      results.push({ heroId: hero.id, name: hero.name, score, breakdown, reasons: [...top, ...warn] });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, input.count ?? 8);
  }

  /** Average edge of each hero against its 5 worst matchups still in the pool (negative = easy to counter). */
  private vulnerability(pool: HeroInfo[]): Map<number, number> {
    return new Map(
      pool.map((hero) => {
        const edges = pool.filter((h) => h.id !== hero.id).map((h) => this.matchupEdge(hero.id, h.id));
        return [hero.id, mean(edges.sort((a, b) => a - b).slice(0, 5))];
      }),
    );
  }

  private names(ids: number[]): string {
    const names = ids.slice(0, 3).map((id) => this.hero(id).name);
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round = (x: number) => Math.round(x * 100) / 100;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function suggest(data: Snapshot, input: DraftInput): Suggestion[] {
  return new Engine(data).suggest(input);
}
