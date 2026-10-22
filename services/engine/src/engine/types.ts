/** Dota 2 positions: 1 carry, 2 mid, 3 offlane, 4 soft support, 5 hard support. */
export type Position = 1 | 2 | 3 | 4 | 5;
export const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];

/**
 * Rank brackets as OpenDota numbers them: 1 Herald, 2 Guardian, 3 Crusader,
 * 4 Archon, 5 Legend, 6 Ancient, 7 Divine, 8 Immortal.
 */
export type RankBracket = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface GamesWins {
  games: number;
  wins: number;
}

export interface HeroInfo {
  id: number;
  name: string;
  roles: string[];
  attackType: "Melee" | "Ranged";
  primaryAttr: string;
}

/**
 * Everything the engine needs, produced by `npm run fetch-data`.
 * Hero ids are stored as string keys because the snapshot is JSON.
 */
export interface Snapshot {
  generatedAt: string;
  heroes: Record<string, HeroInfo>;
  /** Picks and wins per rank bracket, index 0 = Herald ... 7 = Immortal. */
  bracketStats: Record<string, { picks: number[]; wins: number[] }>;
  /** matchups[a][b]: games of hero a against hero b, and wins for hero a. */
  matchups: Record<string, Record<string, GamesWins>>;
  /** synergy["a-b"] with a < b: games where a and b were on the same team, and wins. */
  synergy: Record<string, GamesWins>;
  /** Games per lane role (1 safe, 2 mid, 3 off, 4 jungle). */
  laneRoles: Record<string, Partial<Record<"1" | "2" | "3" | "4", number>>>;
  /** Highest public match id already counted, so daily runs only add new matches. */
  lastPublicMatchId?: number;
}

export interface AllyPick {
  heroId: number;
  position?: Position;
}

export interface DraftInput {
  myPosition: Position;
  allies: AllyPick[];
  /** Enemy picks. Their positions are not visible in game, so the engine guesses them. */
  enemies: number[];
  bans?: number[];
  /** Only known for Steam users; omit to use all ranks. */
  rankBracket?: RankBracket;
  favorites?: number[];
  /** The user's own record per hero id, from their Steam match history. */
  personal?: Record<number, GamesWins>;
  /** How many heroes to return. Default 8. */
  count?: number;
}

export interface ScoreBreakdown {
  counter: number;
  synergy: number;
  meta: number;
  positionFit: number;
  teamNeeds: number;
  comfort: number;
  flex: number;
  pickSafety: number;
}

export interface Suggestion {
  heroId: number;
  name: string;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
}
