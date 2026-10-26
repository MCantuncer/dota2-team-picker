/** Dota 2 positions: 1 carry, 2 mid, 3 offlane, 4 soft support, 5 hard support. */
export type Position = 1 | 2 | 3 | 4 | 5;
export const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];

/**
 * Rank brackets as OpenDota numbers them: 1 Herald, 2 Guardian, 3 Crusader,
 * 4 Archon, 5 Legend, 6 Ancient, 7 Divine, 8 Immortal.
 */
export type RankBracket = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Matchups and synergy are also counted per rank group, two medals each:
 * 1 Herald-Guardian, 2 Crusader-Archon, 3 Legend-Ancient, 4 Divine-Immortal.
 */
export type RankGroup = 1 | 2 | 3 | 4;
export const rankGroup = (bracket: RankBracket): RankGroup => Math.ceil(bracket / 2) as RankGroup;
export const RANK_GROUP_BRACKETS: Record<RankGroup, RankBracket[]> = { 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8] };

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
  /** The same counts split by rank group (from each match's average rank), keyed by RankGroup. */
  rankMatchups?: Record<string, Record<string, Record<string, GamesWins>>>;
  rankSynergy?: Record<string, Record<string, GamesWins>>;
  /** Games per lane role (1 safe, 2 mid, 3 off, 4 jungle). */
  laneRoles: Record<string, Partial<Record<"1" | "2" | "3" | "4", number>>>;
  /** When lane roles were last downloaded; they are refreshed weekly. */
  laneRolesAt?: string;
  /** Games per position [pos 1, ..., pos 5] in the last week, from STRATZ. */
  positions?: Record<string, number[]>;
  positionsAt?: string;
  /**
   * Games and wins per hero by when its team picked it: [1st or 2nd pick, 3rd, 4th or 5th].
   * Counted from the saved ranked games of this patch.
   */
  pickPhase?: Record<string, { games: number[]; wins: number[] }>;
  /** The patch the counts are for, from OpenDota's patch list. */
  patch?: { name: string; startedAt: string };
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

/** A hand-checked hard counter of a hero and where it stands in the draft, with a line to show. */
export interface HardCounterNote {
  counterId: number;
  /** Win-rate points the hero loses with this counter on the enemy team. */
  gap: number;
  /** `enemy`: on the enemy team. `open`: the enemy can still pick it. `out`: banned or on your team. */
  status: "enemy" | "open" | "out";
  text: string;
}

export interface Suggestion {
  heroId: number;
  name: string;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  /** The hero's hard counters, to show apart from the reasons. */
  hardCounters: HardCounterNote[];
}
