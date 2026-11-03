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

/**
 * Pick phase of a team's pick (0-based index within the team), by the Ranked All Pick rounds:
 * 0 first round (1st or 2nd pick), 1 second round (3rd or 4th), 2 last round (5th).
 */
export type PickPhase = 0 | 1 | 2;
export const phaseOf = (teamPickIndex: number): PickPhase => (teamPickIndex < 2 ? 0 : teamPickIndex < 4 ? 1 : 2);

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
   * Games and wins per hero by the round its team picked it in: [1st or 2nd pick, 3rd or 4th, 5th].
   * Counted from the saved ranked games of this patch.
   */
  pickPhase?: Record<string, { games: number[]; wins: number[] }>;
  /**
   * Turns a draft edge into a win chance: chance = 1 / (1 + e^-(a + b * edge)), fitted on saved
   * ranked games for each number of heroes known. Only present when its calibration check passed.
   */
  winModel?: {
    fittedAt: string;
    games: number;
    byKnown: Record<string, { a: number; b: number }>;
  };
  /** Shop items by item id, for item builds. Recipes and items with no cost are left out. */
  items?: Record<string, ItemInfo>;
  /** How often each item is bought on each hero, by game phase, from OpenDota. Keyed by hero id. */
  itemBuilds?: Record<string, ItemPhases>;
  /** When items and item builds were last downloaded; they are refreshed daily. */
  itemsAt?: string;
  /**
   * When players buy their core items, from STRATZ: itemTimings[heroId][position][slice], where the
   * slice is a RankGroup ("1" to "4") or "all" for every rank. Only each hero's two most played
   * positions, and only slices STRATZ had data for.
   */
  itemTimings?: Record<string, Record<string, Partial<Record<ItemTimingSliceKey, ItemTimingSlice>>>>;
  /** When item timings were last downloaded; they are refreshed daily. */
  itemTimingsAt?: string;
  /** What players start with and which boots they buy, from STRATZ: itemStarts[heroId][position], every rank. */
  itemStarts?: Record<string, Record<string, ItemStart>>;
  /** Each hero's learnable abilities and talents, from STRATZ, for skill builds. Keyed by hero id. */
  heroAbilities?: Record<string, HeroAbilities>;
  /**
   * The skill build high-rank players used, from STRATZ guide matches of this patch, for every facet
   * together: skillBuilds[heroId][position]. Refreshed weekly, a few heroes per run.
   */
  skillBuilds?: Record<string, Partial<Record<string, SkillBuildSlice>>>;
  /** The patch the counts are for, from OpenDota's patch list. */
  patch?: { name: string; startedAt: string };
  /** Highest public match id already counted, so daily runs only add new matches. */
  lastPublicMatchId?: number;
}

/** A rank group ("1" to "4") or "all" ranks. */
export type ItemTimingSliceKey = `${RankGroup}` | "all";

/**
 * Item timings for one hero, position and rank slice. `games` is the slice's sample size: the
 * purchase count of its most bought item, since STRATZ gives no game total for item data.
 */
export interface ItemTimingSlice {
  games: number;
  /** Most bought core items first: [item id, average minute bought, minute after which a player is slower than most]. */
  items: [itemId: number, minute: number, lateMinute: number][];
  /**
   * Small items most players buy in lane, like Wraith Band, Magic Wand or Perseverance, in buy order:
   * [item id, average minute bought]. Missing in snapshots from before Nov 2026.
   */
  lane?: [itemId: number, minute: number][];
}

export interface ItemStart {
  games: number;
  /** Items bought at the horn, most bought first: [item id, copies]. */
  start: [itemId: number, count: number][];
  /** Upgraded boots, most bought first: [item id, average minute, share of boot buyers]. */
  boots: [itemId: number, minute: number, share: number][];
}

export interface HeroAbility {
  id: number;
  /** STRATZ's internal name, like `sven_storm_bolt`, for the icon. */
  key: string;
  name: string;
  /** STRATZ's ability slot: 1 to 3 for Q, W, E, 4 and 5 for D and F, 6 for R. */
  slot: number;
  /** 0 when STRATZ doesn't say; the skill build fetch then counts it from real games. */
  maxLevel: number;
  ultimate: boolean;
}

export interface HeroAbilities {
  /** Learnable abilities in hotkey order (Q, W, E, ..., R last). */
  abilities: HeroAbility[];
  /** Talents per tier (levels 10, 15, 20, 25): [left, right] ability ids and names. */
  talents: { id: number; name: string }[][];
}

/** One skill build: the ability or talent id taken at each hero level from 1, 0 for a level with no point. */
export interface SkillBuild {
  levels: number[];
  /** Matches whose order matched this build's group (max order and first points), and its share of all matches. */
  groupMatches: number;
  share: number;
  /** Matches that took exactly these levels; few means the exact order is less certain than the group. */
  exactMatches: number;
}

export interface SkillBuildSlice {
  at: string;
  /** STRATZ game version of the patch the matches came from. */
  gameVersionId: number;
  /** Guide matches with a usable skill build. */
  matches: number;
  build?: SkillBuild;
  /** A second common build, shown as an alternative when the STRATZ totals agree it is common. */
  alternative?: SkillBuild;
  /** Why there is no build: too few matches this patch, or no build most players agree on. */
  none?: "few-matches" | "no-agreement";
  /**
   * Per talent tier: the talent picked in more games, its share of the games that took a talent in
   * that tier, how many games that is (few games at level 20 and 25), and the level players usually took it.
   * `sides` has both talents' games and wins in STRATZ's totals (all games at this rank, not only guides):
   * the starting point the matchup lookup is compared against. Missing in slices saved before it existed.
   */
  talents: {
    tier: number;
    id: number;
    share: number;
    games: number;
    level: number;
    sides?: { id: number; games: number; wins: number }[];
  }[];
}

export interface ItemInfo {
  /** OpenDota's internal name, like `black_king_bar`. */
  key: string;
  name: string;
  cost: number;
  /** Image path on the Steam CDN, like `/apps/dota2/images/dota_react/items/black_king_bar.png`. */
  img: string;
  /** Item ids this item is built from; empty for basic items. */
  components: number[];
}

/** Times each item (by item id) was bought in each phase of the game: before the horn, then up to 10, 25 and after. */
export interface ItemPhases {
  start: Record<string, number>;
  early: Record<string, number>;
  mid: Record<string, number>;
  late: Record<string, number>;
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
  /** Up to 4 lines on why the hero fits this draft, each with its points, then at most one warning. */
  reasons: string[];
  /** Where the score comes from: this draft, or meta, role and comfort. */
  summary: string;
  /** Short labels such as "Favorite (+1.5)" or "Your record 12-8 (+0.9)". */
  tags: string[];
  /** The hero's hard counters, to show apart from the reasons. */
  hardCounters: HardCounterNote[];
}
