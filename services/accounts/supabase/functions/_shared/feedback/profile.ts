/**
 * A player's feedback over their recent games, as saved in player_feedback: the top strengths
 * and problems (findings.ts) over the last WINDOW_DAYS, and last week's problems that are gone
 * this week. Pure: no network or database.
 */
import { type Finding, MIN_TREND_GAMES, type Names, trendFindings } from "./findings.ts";
import type { GameSummary } from "./summary.ts";

/** Bump with any change to PlayerFeedback's shape. */
export const FEEDBACK_VERSION = 1;
export const WINDOW_DAYS = 14;
const WEEK_S = 7 * 24 * 60 * 60;

/** A problem from last week that didn't show up this week. */
export interface Improvement {
  kind: Finding["kind"];
  /** Last week's headline, e.g. "Too many deaths". */
  headline: string;
}

export interface PlayerFeedback {
  version: typeof FEEDBACK_VERSION;
  findings: Finding[];
  improved: Improvement[];
  games: number;
  parsedGames: number;
  /** Unix seconds of the first and last game, null with no games. */
  firstGameAt: number | null;
  lastGameAt: number | null;
}

/**
 * Feedback from the player's summaries. Games outside the window are left out. "Improved"
 * needs at least MIN_TREND_GAMES parsed games in each of the two weeks.
 */
export function buildPlayerFeedback(summaries: GameSummary[], names: Names, nowS: number): PlayerFeedback {
  const games = summaries.filter((g) => g.startTime >= nowS - 2 * WEEK_S && g.startTime <= nowS);
  const times = games.map((g) => g.startTime);
  return {
    version: FEEDBACK_VERSION,
    findings: trendFindings(games, names),
    improved: improvements(games, names, nowS),
    games: games.length,
    parsedGames: games.filter((g) => g.isParsed).length,
    firstGameAt: times.length ? Math.min(...times) : null,
    lastGameAt: times.length ? Math.max(...times) : null,
  };
}

function improvements(games: GameSummary[], names: Names, nowS: number): Improvement[] {
  const thisWeek = games.filter((g) => g.startTime >= nowS - WEEK_S);
  const lastWeek = games.filter((g) => g.startTime < nowS - WEEK_S);
  const parsed = (gs: GameSummary[]) => gs.filter((g) => g.isParsed).length;
  if (parsed(thisWeek) < MIN_TREND_GAMES || parsed(lastWeek) < MIN_TREND_GAMES) return [];
  const problems = (gs: GameSummary[]) => trendFindings(gs, names).filter((f) => f.tone === "problem");
  const now = new Set(problems(thisWeek).map((f) => f.kind));
  return problems(lastWeek).filter((f) => !now.has(f.kind)).map((f) => ({ kind: f.kind, headline: f.headline }));
}
