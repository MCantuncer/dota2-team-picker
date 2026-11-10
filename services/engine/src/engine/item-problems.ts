/**
 * Whether the enemies' problems change what winners buy (item engine plan, step 4, the measurement). Read
 * offline from the matchup cache, which keeps at most 10 wins and 10 losses per hero, position and enemy:
 * too few to credit one enemy, so games are pooled per problem ("wins against enemies with illusions").
 * Every cached enemy weighs the same, however often players meet them.
 *
 * For one hero, position, problem and item:
 * - Case games: the hero's games where a cached enemy brings the problem. Control games: games where no
 *   cached enemy does. Each match counts once and each player at most twice per result (poolGames). A
 *   control game can still hold a problem hero the cache does not list for it, which can only shrink a
 *   difference.
 * - Only games still running HORIZON minutes after the item's usual minute count, and only purchases by
 *   then, so longer games (more items of every kind) don't fake a difference.
 * - The case wins' share is shrunk toward the control wins' share (a beta prior worth PRIOR_GAMES games).
 * - A cell passes when the shrunk share beats the control by MIN_LIFT and by MIN_RATIO, and the lift among
 *   wins beats the lift among losses by MIN_WIN_EDGE (difference in differences). Winners have more gold
 *   and buy more of everything, so only a lift that winners show more than losers says the item answers
 *   the problem.
 * The report then checks the passes against shuffled problem labels (placebo) and held-out players.
 */
import { bigItems, type IsBig, type ItemGame } from "./item-odds";
import { poolGames } from "./matchup-talents";

/** Each side (case and control) needs this many wins and this many losses to be judged. */
export const MIN_WINS = 20;
export const MIN_LOSSES = 10;
/** Weight of the control share in the shrunk case share, in games. */
export const PRIOR_GAMES = 20;
/** The shrunk case share must beat the control share by this many points... */
export const MIN_LIFT = 0.15;
/** ...and be at least this many times it... */
export const MIN_RATIO = 1.5;
/** ...and the lift among wins must beat the lift among losses by this many points. */
export const MIN_WIN_EDGE = 0.1;
/** Purchases count up to this many minutes after the item's usual minute. */
export const HORIZON = 6;

/** One cached row's games: the enemy they were played against. */
export interface EnemyGames {
  enemy: number;
  games: ItemGame[];
}

/** A game once, with every cached enemy it came back for and its big items at their first purchase. */
export interface PooledGame {
  game: ItemGame;
  enemies: number[];
  /** Big item id to the second it was first bought (bigItems). */
  bought: Map<number, number>;
}

/** Each match once, each player at most twice per result, with all the cached enemies it came back for. */
export function poolByMatch(rows: EnemyGames[], isBig: IsBig): PooledGame[] {
  const enemies = new Map<number, number[]>();
  for (const { enemy, games } of rows) {
    for (const g of games) {
      const list = enemies.get(g.match) ?? [];
      if (!list.includes(enemy)) list.push(enemy);
      enemies.set(g.match, list);
    }
  }
  // By match id, so which two games a player keeps doesn't lean on the enemies' ids.
  return poolGames(rows.flatMap((r) => r.games).sort((a, b) => a.match - b.match)).map((game) => ({
    game,
    enemies: enemies.get(game.match) ?? [],
    bought: new Map(bigItems(game, isBig).map(([id, at]) => [id, at])),
  }));
}

export interface Share {
  bought: number;
  games: number;
}

export interface ProblemCell {
  caseWins: Share;
  caseLosses: Share;
  controlWins: Share;
  controlLosses: Share;
  /** The case wins' share shrunk toward the control wins' share. */
  shrunk: number;
  passes: boolean;
}

export const share = (s: Share) => (s.games ? s.bought / s.games : 0);

/** The games needed on each side to judge a cell; a held-out half asks for half. */
export interface MinGames {
  wins: number;
  losses: number;
}

/**
 * The cell for one item. `isCase[i]` says whether games[i] had a cached enemy with the problem; `minute` is
 * the item's usual minute. Undefined when there are too few games to judge.
 */
export function problemCell(
  games: PooledGame[],
  isCase: boolean[],
  item: number,
  minute: number,
  min: MinGames = { wins: MIN_WINS, losses: MIN_LOSSES },
): ProblemCell | undefined {
  const by = (minute + HORIZON) * 60;
  const cells = { caseWins: { bought: 0, games: 0 }, caseLosses: { bought: 0, games: 0 }, controlWins: { bought: 0, games: 0 }, controlLosses: { bought: 0, games: 0 } };
  games.forEach(({ game, bought }, i) => {
    if (game.duration < by) return;
    const side = isCase[i] ? (game.won ? cells.caseWins : cells.caseLosses) : game.won ? cells.controlWins : cells.controlLosses;
    side.games++;
    const at = bought.get(item);
    if (at !== undefined && at <= by) side.bought++;
  });
  const { caseWins, caseLosses, controlWins, controlLosses } = cells;
  if (Math.min(caseWins.games, controlWins.games) < min.wins || Math.min(caseLosses.games, controlLosses.games) < min.losses) return undefined;
  const usual = share(controlWins);
  const shrunk = (caseWins.bought + PRIOR_GAMES * usual) / (caseWins.games + PRIOR_GAMES);
  const winLift = shrunk - usual;
  const lossLift = share(caseLosses) - share(controlLosses);
  const passes = winLift >= MIN_LIFT && shrunk >= MIN_RATIO * usual && winLift - lossLift >= MIN_WIN_EDGE;
  return { ...cells, shrunk, passes };
}

/**
 * The same enemies with the problem moved at random: as many enemies keep it as before, so the case and
 * control groups keep about their sizes but lose any link to the problem.
 */
export function shuffledProblem(enemies: number[], hasProblem: (enemy: number) => boolean, random: () => number): (enemy: number) => boolean {
  const pool = [...enemies];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    // i and j are inside pool.
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const holders = new Set(pool.slice(0, enemies.filter(hasProblem).length));
  return (enemy) => holders.has(enemy);
}

/** The median minute an item is first bought at in these games, or undefined when none bought it. */
export function usualMinute(games: PooledGame[], item: number): number | undefined {
  const minutes = games.flatMap(({ bought }) => {
    const at = bought.get(item);
    return at === undefined ? [] : [at / 60];
  });
  minutes.sort((a, b) => a - b);
  return minutes.length ? minutes[Math.floor((minutes.length - 1) / 2)] : undefined;
}
