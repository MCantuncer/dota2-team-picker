/**
 * Dangerous heroes and their answers, found in ranked games with no hand list (the "game plan against
 * dangerous heroes"). A hero is dangerous when his games swing on whether the other team answers him:
 * he wins well against teams with none of his answers and badly against teams with two or more.
 *
 * The games are split three ways by match id, so no number is checked on the games it was chosen on:
 * - split 0 picks each hero's answers: enemies he plays ANSWER_GAP points or more below what both heroes'
 *   win rates predict (shrunk toward 0 by PRIOR_GAMES games, so a small sample can't make an answer);
 * - split 1 decides whether he gets a plan: how far above or below the expected win rate (from all ten
 *   heroes' usual win rates) he plays against teams with none of the answers and with two or more. The drop
 *   must stay at least MIN_DROP points at the low end of its 95% range, so a hero who is simply strong this
 *   patch, or a lucky sample, does not pass;
 * - split 2 gives the numbers the site shows: his win rate at each step.
 * The settings are frozen here; changing them means checking the list again, not tuning it to a result.
 */

/** One ranked game, as the data job reads it. */
export interface ThreatGame {
  id: number;
  radiant: readonly number[];
  dire: readonly number[];
  radiantWin: boolean;
  minutes: number;
}

/** His record at one step of the answer stair: against teams with 0, 1, or 2+ of his answers. */
export interface StairStep {
  games: number;
  winRate: number;
}

/** A dangerous hero's plan data. Gaps and drops are win rate points (5 = 5%). */
export interface ThreatPlan {
  hero: number;
  /** His answers, worst for him first. `gap` is negative: how far below the expected win rate he plays. */
  answers: { hero: number; gap: number }[];
  /** His win rate against teams with 0, 1 and 2+ of his answers (split 2). */
  stair: [StairStep, StairStep, StairStep];
  /** How much worse than expected he plays with 2+ answers than with none, and the low end of its 95% range (split 1). */
  drop: number;
  dropLow: number;
  /** His win rate by game length, one step per LENGTH_STEPS entry (all games). */
  length: StairStep[];
}

export const ANSWER_GAP = 3;
export const PRIOR_GAMES = 300;
export const MIN_DROP = 4;
/** Each stair step needs this many games in the deciding split. */
export const MIN_STEP_GAMES = 300;
/** Game length steps by their first minute: under 30, 30 to 35, 35 to 40, 40 to 45, 45 and longer. */
export const LENGTH_STEPS = [0, 30, 35, 40, 45] as const;

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
/** Keeps a win rate off 0 and 1, so a hero with very few games can't break the logit. */
const clampRate = (p: number) => Math.min(0.99, Math.max(0.01, p));
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Which third of the games a match belongs to: 0 picks answers, 1 decides, 2 is shown. */
export const splitOf = (matchId: number): 0 | 1 | 2 => (matchId % 3) as 0 | 1 | 2;

/** Each hero's win rate over all the games. */
export function heroWinRates(games: readonly ThreatGame[]): Map<number, number> {
  const count = new Map<number, [number, number]>();
  const add = (hero: number, won: boolean) => {
    const c = count.get(hero) ?? [0, 0];
    c[0]++;
    if (won) c[1]++;
    count.set(hero, c);
  };
  for (const g of games) {
    g.radiant.forEach((h) => add(h, g.radiantWin));
    g.dire.forEach((h) => add(h, !g.radiantWin));
  }
  return new Map([...count].map(([hero, [n, w]]) => [hero, clampRate(w / n)]));
}

/**
 * Every hero's answers from split 0: enemies he plays ANSWER_GAP or more points below the expected win
 * rate against, worst first. The expected rate comes from both heroes' win rates.
 */
export function findAnswers(games: readonly ThreatGame[], rates: ReadonlyMap<number, number>): Map<number, { hero: number; gap: number }[]> {
  const pairs = new Map<number, Map<number, [number, number]>>();
  const add = (hero: number, enemy: number, won: boolean) => {
    const row = pairs.get(hero) ?? new Map<number, [number, number]>();
    const c = row.get(enemy) ?? [0, 0];
    c[0]++;
    if (won) c[1]++;
    row.set(enemy, c);
    pairs.set(hero, row);
  };
  for (const g of games) {
    if (splitOf(g.id) !== 0) continue;
    for (const r of g.radiant) for (const d of g.dire) {
      add(r, d, g.radiantWin);
      add(d, r, !g.radiantWin);
    }
  }
  const out = new Map<number, { hero: number; gap: number }[]>();
  for (const [hero, row] of pairs) {
    const answers: { hero: number; gap: number }[] = [];
    for (const [enemy, [n, wins]] of row) {
      const expected = sigmoid(logit(rates.get(hero) ?? 0.5) - logit(rates.get(enemy) ?? 0.5));
      const gap = (100 * (wins - n * expected)) / (n + PRIOR_GAMES);
      if (gap <= -ANSWER_GAP) answers.push({ hero: enemy, gap: round1(gap) });
    }
    out.set(hero, answers.sort((a, b) => a.gap - b.gap));
  }
  return out;
}

/** Running sums for one hero at one step: games, wins, expected wins and the variance of the wins. */
type Sums = [games: number, wins: number, expected: number, variance: number];

/**
 * The stair for every hero on one split: per hero, sums for 0, 1 and 2+ answers on the other team. The
 * expected win comes from all ten heroes' win rates, so a strong or weak lineup around him is accounted for.
 */
export function stairSums(
  games: readonly ThreatGame[],
  split: 1 | 2,
  answers: ReadonlyMap<number, readonly { hero: number }[]>,
  rates: ReadonlyMap<number, number>,
): Map<number, [Sums, Sums, Sums]> {
  const sets = new Map([...answers].map(([hero, list]) => [hero, new Set(list.map((a) => a.hero))]));
  const out = new Map<number, [Sums, Sums, Sums]>();
  const teamLogit = (team: readonly number[]) => team.reduce((s, h) => s + logit(rates.get(h) ?? 0.5), 0);
  for (const g of games) {
    if (splitOf(g.id) !== split) continue;
    const radiantExpected = sigmoid(teamLogit(g.radiant) - teamLogit(g.dire));
    for (const [team, other, won, expected] of [
      [g.radiant, g.dire, g.radiantWin, radiantExpected],
      [g.dire, g.radiant, !g.radiantWin, 1 - radiantExpected],
    ] as const) {
      for (const hero of team) {
        const set = sets.get(hero);
        if (!set || set.size === 0) continue;
        const step = Math.min(2, other.filter((h) => set.has(h)).length);
        const sums = out.get(hero) ?? [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
        const s = sums[step]!;
        s[0]++;
        if (won) s[1]++;
        s[2] += expected;
        s[3] += expected * (1 - expected);
        out.set(hero, sums);
      }
    }
  }
  return out;
}

/**
 * How much worse than expected he plays with 2+ answers than with none, in points, and the low end of its
 * 95% range. Undefined when a step has fewer than MIN_STEP_GAMES games.
 */
export function answerDrop(sums: readonly [Sums, Sums, Sums]): { drop: number; dropLow: number } | undefined {
  const [none, , two] = sums;
  if (none[0] < MIN_STEP_GAMES || two[0] < MIN_STEP_GAMES) return undefined;
  const above = (s: Sums) => (s[1] - s[2]) / s[0];
  const drop = above(none) - above(two);
  const se = Math.sqrt(none[3] / none[0] ** 2 + two[3] / two[0] ** 2);
  return { drop: round1(100 * drop), dropLow: round1(100 * (drop - 1.96 * se)) };
}

/** Which LENGTH_STEPS entry a game of this many minutes falls in. */
export function lengthStep(minutes: number): number {
  let step = 0;
  LENGTH_STEPS.forEach((from, i) => {
    if (minutes >= from) step = i;
  });
  return step;
}

/** His win rate by game length over all games. */
export function lengthRates(games: readonly ThreatGame[], heroes: ReadonlySet<number>): Map<number, StairStep[]> {
  const counts = new Map<number, [number, number][]>();
  for (const g of games) {
    const step = lengthStep(g.minutes);
    for (const [team, won] of [[g.radiant, g.radiantWin], [g.dire, !g.radiantWin]] as const) {
      for (const hero of team) {
        if (!heroes.has(hero)) continue;
        const c = counts.get(hero) ?? LENGTH_STEPS.map((): [number, number] => [0, 0]);
        c[step]![0]++;
        if (won) c[step]![1]++;
        counts.set(hero, c);
      }
    }
  }
  return new Map([...counts].map(([hero, c]) => [hero, c.map(([n, w]) => ({ games: n, winRate: n ? round1((100 * w) / n) : 0 }))]));
}

/**
 * The dangerous heroes with their plans, biggest drop first, and the length curve of `lengthGroup` heroes
 * pooled (the site shows it next to a plan, for example every hero who is mostly played at position 1).
 */
export function findThreatPlans(games: readonly ThreatGame[], lengthGroup: ReadonlySet<number>): { plans: ThreatPlan[]; groupLength: StairStep[] } {
  const rates = heroWinRates(games);
  const answers = findAnswers(games, rates);
  const decide = stairSums(games, 1, answers, rates);
  const show = stairSums(games, 2, answers, rates);
  const chosen: Omit<ThreatPlan, "length">[] = [];
  for (const [hero, sums] of decide) {
    const drop = answerDrop(sums);
    const shown = show.get(hero);
    if (!drop || drop.dropLow < MIN_DROP || !shown) continue;
    const stair = shown.map(([n, w]) => ({ games: n, winRate: n ? round1((100 * w) / n) : 0 })) as ThreatPlan["stair"];
    chosen.push({ hero, answers: answers.get(hero) ?? [], stair, ...drop });
  }
  const lengths = lengthRates(games, new Set([...chosen.map((p) => p.hero), ...lengthGroup]));
  const pooled = LENGTH_STEPS.map((_, i) => {
    let n = 0;
    let wins = 0;
    for (const hero of lengthGroup) {
      const step = lengths.get(hero)?.[i];
      if (!step) continue;
      n += step.games;
      wins += (step.games * step.winRate) / 100;
    }
    return { games: n, winRate: n ? round1((100 * wins) / n) : 0 };
  });
  const plans = chosen.map((p) => ({ ...p, length: lengths.get(p.hero) ?? [] })).sort((a, b) => b.drop - a.drop);
  return { plans, groupLength: pooled };
}
