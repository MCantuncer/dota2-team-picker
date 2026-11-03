/**
 * The parts of an OpenDota match (`GET /matches/{id}`) that reports use, checked once where
 * the response comes in. Fields that only a parsed replay has are optional; `isParsed` tells
 * whether the replay was parsed.
 */

export interface DeathLogEntry {
  time: number;
  goldLost: number;
  timeDead: number;
  /** Unit key of whoever landed the last hit, e.g. "npc_dota_hero_lina". Null when not given. */
  killer: string | null;
}

/** Percentiles (0 to 1) for the benchmarks beyond the four every parsed match has. */
export interface OtherBenchmarks {
  killsPerMin: number | null;
  /** A high percentile means many deaths: lower is better. */
  deathsPerMin: number | null;
  assistsPerMin: number | null;
  deniesPerMin: number | null;
  heroHealingPerMin: number | null;
  towerDamage: number | null;
}

/** A tower, barracks or ancient destroyed. The key names the building's side and lane. */
export interface BuildingKill {
  time: number;
  /** e.g. "npc_dota_goodguys_tower1_mid" (goodguys are Radiant's buildings). */
  key: string;
}

export interface Purchase {
  time: number;
  key: string;
}

export interface MatchPlayer {
  playerSlot: number;
  heroId: number;
  accountId: number | null;
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
  goldPerMin: number;
  xpPerMin: number;
  netWorth: number;
  heroDamage: number;
  towerDamage: number;
  heroHealing: number;
  level: number;
  /** 0 or 1 is fine; 2 and up means the player abandoned. */
  leaverStatus: number;
  /** Parsed only from here on. */
  lane: number | null;
  isRoaming: boolean | null;
  netWorthByMinute: number[] | null;
  teamfightParticipation: number | null;
  stunSeconds: number | null;
  deathsLog: DeathLogEntry[] | null;
  purchaseLog: Purchase[] | null;
  observersPlaced: number | null;
  sentriesPlaced: number | null;
  wardsDestroyed: number | null;
  /** Totals at each minute, from minute 0. Parsed only. */
  lastHitsByMinute: number[] | null;
  deniesByMinute: number[] | null;
  xpByMinute: number[] | null;
  /** Benchmark percentiles (0 to 1) against everyone playing the hero. */
  benchmarks: { goldPerMin: number; xpPerMin: number; lastHitsPerMin: number; heroDamagePerMin: number } | null;
  otherBenchmarks: OtherBenchmarks | null;
  /** Damage this player took, by the enemy ability or item key that dealt it ("null" is attacks). Parsed only. */
  damageReceived: Record<string, number> | null;
}

/** One player's part in a teamfight, in the same order as `Match.players`. */
export interface FightPlayer {
  deaths: number;
  goldDelta: number;
  damage: number;
  healing: number;
}

export interface Teamfight {
  startS: number;
  endS: number;
  players: FightPlayer[];
}

export interface Match {
  matchId: number;
  isParsed: boolean;
  radiantWin: boolean;
  durationS: number;
  gameMode: number;
  lobbyType: number;
  radiantScore: number;
  direScore: number;
  /** Radiant's gold lead at each minute (negative when Dire leads). Parsed only. */
  radiantGoldAdv: number[] | null;
  players: MatchPlayer[];
  /** Parsed only. */
  teamfights: Teamfight[] | null;
  /** Buildings destroyed, in time order. Parsed only. */
  buildingKills: BuildingKill[] | null;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (o: Obj, key: string): number => (isNum(o[key]) ? o[key] : 0);
const numOrNull = (o: Obj, key: string): number | null => (isNum(o[key]) ? o[key] : null);
const numArray = (v: unknown): number[] | null => (Array.isArray(v) && v.every(isNum) ? v : null);

/** Slots 0-127 are Radiant, 128 and up Dire. */
export const isRadiantSlot = (slot: number) => slot < 128;

/**
 * Reads an OpenDota match response. Throws when the core fields (id, result, duration,
 * ten players with heroes) are missing, so a broken response never becomes a report.
 */
export function readOpenDotaMatch(raw: unknown): Match {
  if (!isObj(raw) || !isNum(raw.match_id) || typeof raw.radiant_win !== "boolean" || !isNum(raw.duration)) {
    throw new Error("OpenDota match: missing id, result or duration");
  }
  if (!Array.isArray(raw.players) || raw.players.length !== 10) {
    throw new Error("OpenDota match: expected 10 players");
  }
  const isParsed = isNum(raw.version);
  const players = raw.players.map((p) => readPlayer(p, isParsed));
  return {
    matchId: raw.match_id,
    isParsed,
    radiantWin: raw.radiant_win,
    durationS: raw.duration,
    gameMode: num(raw, "game_mode"),
    lobbyType: num(raw, "lobby_type"),
    radiantScore: num(raw, "radiant_score"),
    direScore: num(raw, "dire_score"),
    radiantGoldAdv: isParsed ? numArray(raw.radiant_gold_adv) : null,
    players,
    teamfights: isParsed ? readTeamfights(raw.teamfights) : null,
    buildingKills: isParsed ? readBuildingKills(raw.objectives) : null,
  };
}

function readPlayer(p: unknown, isParsed: boolean): MatchPlayer {
  if (!isObj(p) || !isNum(p.player_slot) || !isNum(p.hero_id) || p.hero_id <= 0) {
    throw new Error("OpenDota match: a player has no slot or hero");
  }
  const parsed = <T>(value: T): T | null => (isParsed ? value : null);
  return {
    playerSlot: p.player_slot,
    heroId: p.hero_id,
    accountId: isNum(p.account_id) && p.account_id > 0 ? p.account_id : null,
    kills: num(p, "kills"),
    deaths: num(p, "deaths"),
    assists: num(p, "assists"),
    lastHits: num(p, "last_hits"),
    denies: num(p, "denies"),
    goldPerMin: num(p, "gold_per_min"),
    xpPerMin: num(p, "xp_per_min"),
    netWorth: num(p, "net_worth"),
    heroDamage: num(p, "hero_damage"),
    towerDamage: num(p, "tower_damage"),
    heroHealing: num(p, "hero_healing"),
    level: num(p, "level"),
    leaverStatus: num(p, "leaver_status"),
    lane: parsed(numOrNull(p, "lane")),
    isRoaming: parsed(typeof p.is_roaming === "boolean" ? p.is_roaming : null),
    netWorthByMinute: parsed(numArray(p.networth_t)),
    lastHitsByMinute: parsed(numArray(p.lh_t)),
    deniesByMinute: parsed(numArray(p.dn_t)),
    xpByMinute: parsed(numArray(p.xp_t)),
    teamfightParticipation: parsed(numOrNull(p, "teamfight_participation")),
    stunSeconds: parsed(numOrNull(p, "stuns")),
    deathsLog: parsed(readDeaths(p.deaths_log)),
    purchaseLog: parsed(readPurchases(p.purchase_log)),
    observersPlaced: parsed(numOrNull(p, "obs_placed")),
    sentriesPlaced: parsed(numOrNull(p, "sen_placed")),
    wardsDestroyed: parsed(isNum(p.observer_kills) && isNum(p.sentry_kills) ? p.observer_kills + p.sentry_kills : null),
    benchmarks: readBenchmarks(p.benchmarks),
    otherBenchmarks: readOtherBenchmarks(p.benchmarks),
    damageReceived: parsed(readNumberMap(p.damage_inflictor_received)),
  };
}

function readDeaths(v: unknown): DeathLogEntry[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(isObj).filter((d) => isNum(d.time)).map((d) => ({
    time: num(d, "time"),
    goldLost: num(d, "gold_lost"),
    timeDead: num(d, "time_dead"),
    killer: typeof d.key === "string" && d.key !== "" ? d.key : null,
  }));
}

function readPurchases(v: unknown): Purchase[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(isObj).flatMap((
    x,
  ) => (isNum(x.time) && typeof x.key === "string" ? [{ time: x.time, key: x.key }] : []));
}

const benchmarkPct = (v: Obj, key: string): number | null => {
  const entry = v[key];
  return isObj(entry) && isNum(entry.pct) ? entry.pct : null;
};

function readBenchmarks(v: unknown): MatchPlayer["benchmarks"] {
  if (!isObj(v)) return null;
  const pct = (key: string) => benchmarkPct(v, key);
  const [gpm, xpm, lh, dmg] = ["gold_per_min", "xp_per_min", "last_hits_per_min", "hero_damage_per_min"].map(pct);
  if (gpm === null || xpm === null || lh === null || dmg === null) return null;
  return { goldPerMin: gpm, xpPerMin: xpm, lastHitsPerMin: lh, heroDamagePerMin: dmg };
}

function readOtherBenchmarks(v: unknown): OtherBenchmarks | null {
  if (!isObj(v)) return null;
  return {
    killsPerMin: benchmarkPct(v, "kills_per_min"),
    deathsPerMin: benchmarkPct(v, "deaths_per_min"),
    assistsPerMin: benchmarkPct(v, "assists_per_min"),
    deniesPerMin: benchmarkPct(v, "denies_per_min"),
    heroHealingPerMin: benchmarkPct(v, "hero_healing_per_min"),
    towerDamage: benchmarkPct(v, "tower_damage"),
  };
}

function readBuildingKills(v: unknown): BuildingKill[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter(isObj)
    .flatMap((o) =>
      o.type === "building_kill" && isNum(o.time) && typeof o.key === "string" ? [{ time: o.time, key: o.key }] : []
    )
    .sort((a, b) => a.time - b.time);
}

function readNumberMap(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null;
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => isNum(e[1])));
}

/** Teamfights with a player entry for each of the ten players; others are dropped. */
function readTeamfights(v: unknown): Teamfight[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter(isObj).flatMap((t) => {
    if (!isNum(t.start) || !isNum(t.end) || !Array.isArray(t.players) || t.players.length !== 10) return [];
    const players = t.players.map((p) =>
      isObj(p)
        ? {
          deaths: num(p, "deaths"),
          goldDelta: num(p, "gold_delta"),
          damage: num(p, "damage"),
          healing: num(p, "healing"),
        }
        : { deaths: 0, goldDelta: 0, damage: 0, healing: 0 }
    );
    return [{ startS: t.start, endS: t.end, players }];
  });
}
