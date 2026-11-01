/**
 * The numbers a post-game report shows, worked out from one match for one side. Pure: no
 * network or database, so it can run in the build-reports job and be tested on saved matches.
 *
 * Stored as `match_reports.facts` with `facts_version`. Change the shape only together with
 * FACTS_VERSION, and keep the website able to read every older version.
 */
import { isRadiantSlot, type Match, type MatchPlayer } from "./match.ts";

export const FACTS_VERSION = 1;

/** Items at or above this cost count as key items on a hero card. */
const KEY_ITEM_MIN_COST = 2000;
const KEY_ITEMS_SHOWN = 6;
/** Lead swings are measured over this many minutes. */
const SWING_WINDOW_MIN = 3;
const SWINGS_SHOWN = 3;
const LANE_MINUTE = 10;
/** Physical lanes: 1 bottom, 2 mid, 3 top. 4 is the jungle. */
const LANE_NAMES = { 1: "bottom", 2: "mid", 3: "top" } as const;

export type LaneName = (typeof LANE_NAMES)[keyof typeof LANE_NAMES];

/** A shop item, as the hero-data snapshot lists it, looked up by its OpenDota key. */
export interface ItemCost {
  id: number;
  cost: number;
}

export interface Swing {
  fromMinute: number;
  toMinute: number;
  /** Change in our gold lead over the window; negative when it went their way. */
  change: number;
}

export interface LaneResult {
  lane: LaneName;
  ourHeroes: number[];
  theirHeroes: number[];
  /** Our side's total net worth in this lane at 10 minutes minus theirs. */
  netWorthDiff: number;
}

export interface HeroCard {
  heroId: number;
  kills: number;
  deaths: number;
  assists: number;
  goldPerMin: number;
  xpPerMin: number;
  lastHits: number;
  denies: number;
  netWorth: number;
  heroDamage: number;
  towerDamage: number;
  heroHealing: number;
  level: number;
  abandoned: boolean;
  /** The fields below need a parsed replay and are null without one. */
  lane: LaneName | "jungle" | null;
  isRoaming: boolean | null;
  /** Percent (0 to 100) of the hero's players this game beat. */
  benchmarks: { goldPerMin: number; xpPerMin: number; lastHitsPerMin: number; heroDamagePerMin: number } | null;
  /** Share (0 to 1) of the team's kills this hero took part in. */
  teamfightShare: number | null;
  stunSeconds: number | null;
  deathsBefore10: number | null;
  goldLostToDeaths: number | null;
  secondsDead: number | null;
  /** Key items in the order bought, with the minute of the first purchase. */
  keyItems: { itemId: number; minute: number }[] | null;
  wards: { observers: number; sentries: number; destroyed: number } | null;
}

export interface Facts {
  version: typeof FACTS_VERSION;
  /** Built without a parsed replay: the parse-only fields are null. */
  isBasic: boolean;
  matchId: number;
  durationS: number;
  gameMode: number;
  lobbyType: number;
  side: "radiant" | "dire";
  won: boolean;
  score: { ours: number; theirs: number };
  /** Our gold lead at each minute (negative when behind). */
  goldLead: number[] | null;
  swings: Swing[] | null;
  /** Null when the game ended before 10 minutes or the replay isn't parsed. */
  lanes: LaneResult[] | null;
  /** Our five, in slot order. */
  heroes: HeroCard[];
  /** The enemy heroes, in slot order. Nothing else about the enemy players is kept. */
  enemyHeroes: number[];
}

/**
 * The report's facts for one side of a match. `items` maps an item's OpenDota key (like
 * `black_king_bar`) to its id and cost; without it, key items are left out.
 */
export function buildFacts(match: Match, isRadiant: boolean, items: Record<string, ItemCost> = {}): Facts {
  const ours = match.players.filter((p) => isRadiantSlot(p.playerSlot) === isRadiant);
  const theirs = match.players.filter((p) => isRadiantSlot(p.playerSlot) !== isRadiant);
  const goldLead = match.radiantGoldAdv?.map((g) => (isRadiant ? g : -g)) ?? null;
  return {
    version: FACTS_VERSION,
    isBasic: !match.isParsed,
    matchId: match.matchId,
    durationS: match.durationS,
    gameMode: match.gameMode,
    lobbyType: match.lobbyType,
    side: isRadiant ? "radiant" : "dire",
    won: match.radiantWin === isRadiant,
    score: isRadiant
      ? { ours: match.radiantScore, theirs: match.direScore }
      : { ours: match.direScore, theirs: match.radiantScore },
    goldLead,
    swings: goldLead ? biggestSwings(goldLead) : null,
    lanes: match.isParsed && match.durationS >= LANE_MINUTE * 60 ? laneResults(ours, theirs) : null,
    heroes: ours.map((p) => heroCard(p, items)),
    enemyHeroes: theirs.map((p) => p.heroId),
  };
}

/** The windows where our gold lead moved most, biggest first, not overlapping. */
export function biggestSwings(lead: number[]): Swing[] {
  const windows: Swing[] = [];
  for (let to = SWING_WINDOW_MIN; to < lead.length; to++) {
    const from = to - SWING_WINDOW_MIN;
    windows.push({ fromMinute: from, toMinute: to, change: (lead[to] ?? 0) - (lead[from] ?? 0) });
  }
  windows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const picked: Swing[] = [];
  for (const w of windows) {
    if (picked.length === SWINGS_SHOWN) break;
    if (w.change === 0) break;
    if (picked.every((p) => w.toMinute <= p.fromMinute || w.fromMinute >= p.toMinute)) picked.push(w);
  }
  return picked;
}

/**
 * Who won each lane at 10 minutes, by the total net worth of each side's players in it.
 * Roaming and jungle players are left out. A lane with nobody from one side is skipped.
 */
export function laneResults(ours: MatchPlayer[], theirs: MatchPlayer[]): LaneResult[] | null {
  const results: LaneResult[] = [];
  for (const lane of [1, 2, 3] as const) {
    const inLane = (p: MatchPlayer) => p.lane === lane && p.isRoaming !== true;
    const us = ours.filter(inLane);
    const them = theirs.filter(inLane);
    if (!us.length || !them.length) continue;
    const worth = (ps: MatchPlayer[]) => ps.reduce((sum, p) => sum + (p.netWorthByMinute?.[LANE_MINUTE] ?? NaN), 0);
    const diff = worth(us) - worth(them);
    if (!Number.isFinite(diff)) return null;
    results.push({
      lane: LANE_NAMES[lane],
      ourHeroes: us.map((p) => p.heroId),
      theirHeroes: them.map((p) => p.heroId),
      netWorthDiff: diff,
    });
  }
  return results;
}

function heroCard(p: MatchPlayer, items: Record<string, ItemCost>): HeroCard {
  const pct = (v: number) => Math.round(v * 100);
  return {
    heroId: p.heroId,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    goldPerMin: p.goldPerMin,
    xpPerMin: p.xpPerMin,
    lastHits: p.lastHits,
    denies: p.denies,
    netWorth: p.netWorth,
    heroDamage: p.heroDamage,
    towerDamage: p.towerDamage,
    heroHealing: p.heroHealing,
    level: p.level,
    abandoned: p.leaverStatus >= 2,
    lane: p.lane === 4 ? "jungle" : p.lane === 1 || p.lane === 2 || p.lane === 3 ? LANE_NAMES[p.lane] : null,
    isRoaming: p.isRoaming,
    benchmarks: p.benchmarks && {
      goldPerMin: pct(p.benchmarks.goldPerMin),
      xpPerMin: pct(p.benchmarks.xpPerMin),
      lastHitsPerMin: pct(p.benchmarks.lastHitsPerMin),
      heroDamagePerMin: pct(p.benchmarks.heroDamagePerMin),
    },
    teamfightShare: p.teamfightParticipation === null ? null : Math.round(p.teamfightParticipation * 100) / 100,
    stunSeconds: p.stunSeconds === null ? null : Math.round(p.stunSeconds * 10) / 10,
    deathsBefore10: p.deathsLog?.filter((d) => d.time < LANE_MINUTE * 60).length ?? null,
    goldLostToDeaths: p.deathsLog?.reduce((sum, d) => sum + d.goldLost, 0) ?? null,
    secondsDead: p.deathsLog?.reduce((sum, d) => sum + d.timeDead, 0) ?? null,
    keyItems: p.purchaseLog && Object.keys(items).length ? keyItems(p.purchaseLog, items) : null,
    wards: p.observersPlaced === null || p.sentriesPlaced === null || p.wardsDestroyed === null
      ? null
      : { observers: p.observersPlaced, sentries: p.sentriesPlaced, destroyed: p.wardsDestroyed },
  };
}

function keyItems(log: { time: number; key: string }[], items: Record<string, ItemCost>) {
  const seen = new Set<string>();
  const picked: { itemId: number; minute: number }[] = [];
  for (const { time, key } of [...log].sort((a, b) => a.time - b.time)) {
    const item = items[key];
    if (!item || item.cost < KEY_ITEM_MIN_COST || seen.has(key)) continue;
    seen.add(key);
    picked.push({ itemId: item.id, minute: Math.max(0, Math.floor(time / 60)) });
    if (picked.length === KEY_ITEMS_SHOWN) break;
  }
  return picked;
}
