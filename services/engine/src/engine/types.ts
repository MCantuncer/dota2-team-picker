import type { StairStep, ThreatPlan } from "./threat";
import type { PickWhy } from "./why";

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

/**
 * One hero's lane against another: [games, won, drawn, lost], stomps counted in won and lost, then the
 * hero's average last hits in those lanes (left out by downloads before it was added). A tuple, not an
 * object, because the snapshot holds about 50,000 of them.
 */
export type LaneCounts = [games: number, won: number, drawn: number, lost: number, lastHits?: number];

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
  /**
   * Where the four count fields above come from: STRATZ (every ranked game, replaced on each
   * refresh) or, when missing, our own sample of public matches (added to on each refresh).
   * `patchGames` is set while a new patch is young: the counts are then that many of this patch's
   * ranked games plus a quarter of STRATZ's (see data/patch-matchups.ts).
   */
  matchupsFrom?: { source: "stratz"; at: string; patchGames?: number };
  /** Hard counters found in the counts (see data-hard-counters.ts), the engine's only hard counters. */
  dataHardCounters?: { hero: number; counter: number; gap: number; names: string }[];
  /** Refreshes in a row each "hero-counter" pair has been past the line, for the hold. */
  hardCounterStreaks?: Record<string, number>;
  /**
   * Lane results from STRATZ: laneOutcomes[slice][a][b] is hero a's lane against hero b, slice "0" for
   * every rank and "1" to "4" per RankGroup. Pairs under 300 games are left out (see stratz-lanes.ts).
   */
  laneOutcomes?: Record<string, Record<string, Record<string, LaneCounts>>>;
  /** When lane results were last downloaded; they are refreshed weekly. */
  laneOutcomesAt?: string;
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
   * Learned multipliers on each score part (1 = the hand-set weight), fitted on saved ranked games.
   * Only present when, on newer games, the learned weights beat the hand-set ones and the highest
   * win rate rival on win lift (see backtest/score-weights.ts).
   */
  scoreWeights?: {
    fittedAt: string;
    /** Picks the weights were fitted on, and the win lift (points) they and the hand weights got on the check. */
    picks: number;
    lift: { learned: number; hand: number };
    weights: ScoreWeights;
  };
  /**
   * Turns a draft edge into a win chance: chance = 1 / (1 + e^-(a + b * edge)), fitted on saved
   * ranked games for each number of heroes known. Only present when its calibration check passed.
   */
  winModel?: {
    fittedAt: string;
    games: number;
    byKnown: Record<string, { a: number; b: number }>;
  };
  /**
   * What drafts like this really won: Radiant's win rate on fair public ranked games, by Radiant's
   * draft edge once all 10 heroes are picked, with its 95% range. Band i holds edges from cuts[i - 1]
   * up to (not including) cuts[i]; the first and last bands are open. Only present when the check on
   * newer games passed (see backtest/win-range.ts).
   */
  winRange?: {
    fittedAt: string;
    /** Games the bands were fitted on, and the days they were played on. */
    games: number;
    days: { from: string; to: string };
    cuts: number[];
    bands: { games: number; won: number; low: number; high: number }[];
    /** Per band, the newer games the check used and Radiant's win rate on them, for the Proof Page. */
    check?: { games: number; won: number }[];
  };
  /** Shop items by item id, for item builds. Recipes and items with no cost are left out. */
  items?: Record<string, ItemInfo>;
  /** How often each item is bought on each hero, by game phase, from OpenDota. Keyed by hero id. */
  itemBuilds?: Record<string, ItemPhases>;
  /** When items and item builds were last downloaded; they are refreshed daily. */
  itemsAt?: string;
  /** The neutral tiers, artifacts and enchantments of the patch, from the game file; refreshed daily. */
  neutrals?: NeutralPool;
  /**
   * The neutral items players chose this patch, from the saved ranked games: per hero and position ("0" for every
   * position), and per position over every hero, for heroes with few games yet. Rebuilt every refresh.
   */
  neutralChoices?: {
    games: number;
    heroes: Record<string, Record<string, NeutralChoices>>;
    positions: Record<string, NeutralChoices>;
  };
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
  /** Each hero's learnable abilities (from STRATZ) and talents (from the game files), for skill builds. Keyed by hero id. */
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
  /**
   * Dangerous heroes and their answers, found weekly in about a million recent ranked games (see
   * threat.ts), biggest drop first, with the game length line of position 1 heroes pooled.
   */
  threatPlans?: { at: string; games: number; plans: ThreatPlan[]; pos1Length: StairStep[] };
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
  /**
   * Every lasting item from SHARE_MIN_COST gold bought in at least SHARE_MIN of the games, most bought first:
   * [item id, games that bought it]. STRATZ counts one week at a time, so two daily copies of the snapshot from
   * different weeks show which items are bought more or less often (item-trends.ts). On the "all" slice only;
   * missing in snapshots from before 2026-11-11.
   */
  shares?: [itemId: number, games: number][];
  /**
   * When the most bought finished core item from KEY_ITEM_MIN_COST gold (not boots) was done, and how those games
   * ended: [minute, games, wins] for each minute with at least PACE_MIN_SHARE of its purchases, earliest first.
   * Positions 1 to 3 only. It shows when, not why: a fast item often follows a game that was already going well.
   * Missing in snapshots from before 2026-11-12.
   */
  pace?: { itemId: number; minutes: [minute: number, games: number, wins: number][] };
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

/** The hero level of each talent tier. */
export const TALENT_LEVELS: readonly number[] = [10, 15, 20, 25];

export interface HeroAbilities {
  /** Learnable abilities in hotkey order (Q, W, E, ..., R last). */
  abilities: HeroAbility[];
  /** Talents per tier (levels 10, 15, 20, 25): [left, right] ability ids and names, on the sides the game shows them. */
  talents: { id: number; name: string }[][];
  /**
   * "game" when the talents were read from the game files (data/talents.ts), which STRATZ's constants then leave
   * alone. Missing on talents from STRATZ's constants, which can lag a patch.
   */
  talentsFrom?: "game";
  /**
   * The hero's innate abilities by name (Anti-Mage: ["Persecutor"]), from the game files. Talents can name one, and
   * the talent tree marks those with the game's innate icon. Missing until the talents step has run.
   */
  innate?: string[];
}

/** One skill build: the ability or talent id taken at each hero level from 1, 0 for a level with no point. */
export interface SkillBuild {
  /** The ability or attribute bonus taken at each level from 1 (0 for none); talents too in slices without `talentsApart`. */
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
  /**
   * What these guide games (all wins) bought when a key item was late, by key item id (see item-paths.ts).
   * `{}` when no key item passes; missing in slices saved before it existed, which makes the slice due again.
   */
  itemPaths?: Record<string, KeyPaths>;
  /**
   * True when talents were placed beside the level's ability point (a talent doesn't use the point since 7.4x), so
   * `build.levels` holds abilities only, except for a hero with a point every level (Invoker), which keeps its talents
   * there. Slices saved before it put each talent on a level of its own, one level late from 10 on, and are due again.
   */
  talentsApart?: true;
}

/** One step of a late path: the item, its minute, and how many late games bought it next. */
export type PathStep = [itemId: number, minute: number, games: number];

/** One key item's split of the guide games still running at its late minute (see item-paths.ts). */
export interface KeyPaths {
  /** The minute after which the key item counts as late. */
  late: number;
  /** Games still running at `late`, and how many of them had the key item by then. */
  running: number;
  onTime: number;
  /** The late group's path, when the group has enough games and a first step passes. */
  path?: {
    games: number;
    steps: PathStep[];
    /** Late games that bought the key item after `late`. */
    keyLater: number;
  };
}

export interface ItemInfo {
  /** OpenDota's internal name, like `black_king_bar`. */
  key: string;
  name: string;
  cost: number;
  /** Image path on the Steam CDN, like `/apps/dota2/images/dota_react/items/black_king_bar.png`. */
  img: string;
  /** Item ids this item is built from; empty for basic items. The recipe is what `cost` leaves after them. */
  components: number[];
  /** What the item adds to the hero, as the shop shows it: `+50` Health, `+20%` Magic Resistance. Left out when none. */
  stats?: ItemStat[];
  /** The item's own spells, like Black King Bar's Avatar. Left out when none. */
  abilities?: ItemAbility[];
  /** Seconds before the item can be used again, and the mana it costs, when it has a spell that is used. */
  cooldown?: number;
  manaCost?: number;
}

export interface ItemStat {
  /** The signed amount with its unit, like `+50` or `+20%`. */
  value: string;
  /** What it adds to, like `Health` or `Magic Resistance`. */
  label: string;
}

export interface ItemAbility {
  /** Used by the player (OpenDota's active, toggle and use) or always on. */
  kind: "active" | "passive";
  name: string;
  /** What the spell does, as the shop's tooltip says it, without its number lines. */
  text?: string;
  /** The tooltip's number lines, like Duration `9s` or Dispel Type `Basic Dispel`. */
  facts?: { label: string; value: string }[];
}

/**
 * A neutral item: an artifact crafted at a tier, or an enchantment put on it. Neutral items have no gold cost and
 * never come from the shop, so they are kept apart from `items`.
 */
export interface NeutralItem {
  /** OpenDota's internal name, like `vile_phial` or `enhancement_brawny`. */
  key: string;
  name: string;
  /** Image path on the Steam CDN. */
  img: string;
  kind: "artifact" | "enchantment";
  /** The artifact's tier (1 to 4). Enchantments come at every tier, with a level for each. */
  tier?: number;
  /** The artifact this one is a used-up form of, by item id: Disgraced Regalia is Divine Regalia after a death. */
  brokenOf?: number;
  /** What an artifact adds, as the game lists it, without zero amounts. */
  stats?: ItemStat[];
  /** An enchantment's bonuses at each of its levels: levels[0] is level 1. Bonuses that cost (- Armor) keep their sign. */
  levels?: ItemStat[][];
  abilities?: ItemAbility[];
  /** Seconds before an artifact's spell or effect comes back. */
  cooldown?: number;
}

/** The hero attributes enchantments are offered by, as the game file names them. */
export const ENCHANT_GROUPS = ["global", "strength", "agility", "intelligence", "universal"] as const;
export type EnchantGroup = (typeof ENCHANT_GROUPS)[number];

/** One neutral tier as the game file sets it. */
export interface NeutralTier {
  tier: number;
  /** The earliest minute it can be crafted; madstones decide when it really is. */
  minute: number;
  /** Madstones a craft costs. */
  craftCost: number;
  /** Artifacts offered at a craft. */
  options: number;
  /** The tier's artifacts by item id, in the file's pools (one artifact of a pool is offered at a time). */
  pools: number[][];
  /** Enchantments offered per hero attribute ("global" for every hero): [item id, level]. */
  enchants: Record<EnchantGroup, [itemId: number, level: number][]>;
}

/** The neutral items of the patch, from the game's own file, with the tooltips of every artifact and enchantment. */
export interface NeutralPool {
  at: string;
  tiers: NeutralTier[];
  items: Record<string, NeutralItem>;
}

/** What players chose at one neutral tier, from the saved ranked games of the patch. */
export interface NeutralTierChoice {
  /** Choices counted: each craft of the tier in a parsed game, else the neutral item a game ended with. */
  picks: number;
  /** Artifacts by times chosen, most first: [item id, picks]. */
  artifacts: [itemId: number, picks: number][];
  /** Enchantments by times chosen, most first: [item id, picks]. Fewer than `picks`: older games kept none. */
  enchants: [itemId: number, picks: number][];
  /** The usual (median) minute of the tier's first craft, from parsed games, and the crafts it is from. */
  minute?: [minute: number, crafts: number];
}

/** Neutral choices per tier ("1" to "4"). */
export type NeutralChoices = Record<string, NeutralTierChoice>;

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

/** Enemy positions a player set by hand, by hero id. The engine guesses the rest. */
export type EnemyPositions = Partial<Record<number, Position>>;

export interface DraftInput {
  myPosition: Position;
  allies: AllyPick[];
  /** Enemy picks. Their positions are not visible in game, so the engine guesses them. */
  enemies: number[];
  /** Enemy positions the player set by hand, which override the guess for those heroes. */
  enemyPositions?: EnemyPositions;
  bans?: number[];
  /** Only known for Steam users; omit to use all ranks. */
  rankBracket?: RankBracket;
  favorites?: number[];
  /** The user's Top 5 for this position (hero ids, best first). Only heroes also in `favorites` count. */
  top?: number[];
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

/** A multiplier per score part. */
export type ScoreWeights = Record<keyof ScoreBreakdown, number>;

/** A hard counter of a hero and where it stands in the draft, with a line to show. */
export interface HardCounterNote {
  counterId: number;
  /** Win-rate points the hero loses with this counter on the enemy team. */
  gap: number;
  /** `enemy`: on the enemy team. `open`: the enemy can still pick it. `out`: banned or on your team. */
  status: "enemy" | "open" | "out";
  text: string;
}

/** Score points one hero in the draft accounts for. */
export interface HeroPoints {
  heroId: number;
  points: number;
}

export interface Suggestion {
  heroId: number;
  name: string;
  score: number;
  /**
   * The standard error of the score, in points: how far its data parts (counters, synergy, win
   * rate and the player's own record) could be off from the games behind them. Two heroes whose
   * scores differ by less than about twice this are too close to call.
   */
  error: number;
  breakdown: ScoreBreakdown;
  /** The counter part per enemy picked, in score points (they add up to `breakdown.counter`). */
  counterBy: HeroPoints[];
  /** The synergy part per ally picked, in score points (they add up to `breakdown.synergy`). */
  synergyBy: HeroPoints[];
  /** The player's own record on the hero and the comfort points it gives, with their error; null without games. */
  record: (GamesWins & { points: number; error: number }) | null;
  /** Up to 4 lines on why the hero fits this draft, each with its points, then at most one warning. */
  reasons: string[];
  /** Where the score comes from (this draft, or meta, role and comfort) and the hero's place. */
  summary: string;
  /** Place among every hero scored for the position in this draft, 1 = best. */
  place: { rank: number; of: number };
  /** Short labels such as "Favorite (+1.5)" or "Your record 12-8 (+0.9)". */
  tags: string[];
  /** The hero's hard counters, to show apart from the reasons. */
  hardCounters: HardCounterNote[];
  /** The numbers behind every score part, for the Why details. Set on every hero `suggest` returns. */
  why?: PickWhy;
}
