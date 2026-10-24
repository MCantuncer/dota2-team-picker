/**
 * Builds data/snapshot.json from the free OpenDota API.
 *
 *   npm run fetch-data -- [--pages 200]
 *
 * Each run refreshes hero stats and lane roles, then reads recent public
 * matches page by page (100 per page) and adds their matchups and synergies
 * to the counts already in the snapshot. Old counts fade a little every day so
 * the data follows the meta, and drop to a quarter when a new patch (7.42 after
 * 7.41) comes out. Matches from before the current patch are not counted. Lane
 * roles change slowly and cost one request per hero, so they are refreshed once
 * a week.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { rankGroup, type GamesWins, type HeroInfo, type RankBracket, type Snapshot } from "../engine/types";

const API = "https://api.opendota.com/api";
const SNAPSHOT_PATH = "data/snapshot.json";
/** The free API allows 60 requests a minute; stay well below it. */
const REQUEST_GAP_MS = 1500;
/** How long to wait after a 429 when the API does not say. */
const RATE_LIMIT_WAIT_MS = 60_000;
/** Share of old matchup and synergy counts kept per day since the last run. */
const DECAY_PER_DAY = 0.99;
/**
 * Share of the counts kept when a new patch comes out. Most matchups survive a
 * patch, so the old data is a better start than nothing while new games come in.
 */
const PATCH_CARRYOVER = 0.25;
const LANE_ROLES_MAX_AGE_DAYS = 7;
/**
 * Stop reading match pages when the API's daily allowance drops this low.
 * The free tier allows about 3,000 requests a day per IP, and GitHub runners
 * share IPs, so leave room for others and for the next run.
 */
const DAILY_RESERVE = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ranked and unranked normal drafts: All Pick, Captains Mode, Random Draft, Single Draft, All Random, Captains Draft, Ranked All Pick. */
const GAME_MODES = new Set([1, 2, 3, 4, 5, 16, 22]);
const MIN_DURATION_S = 15 * 60;

let lastRequest = 0;
/** Requests left today, from the API's x-rate-limit-remaining-day header. */
let remainingToday = Infinity;

async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const res = await fetch(API + path).catch((err: unknown) => err as Error);
    const left = res instanceof Error ? null : res.headers.get("x-rate-limit-remaining-day");
    if (left !== null && Number.isFinite(Number(left))) remainingToday = Number(left);
    if (!(res instanceof Error) && res.ok) return (await res.json()) as T;
    const status = res instanceof Error ? res.message : `HTTP ${res.status}`;
    const limited = !(res instanceof Error) && res.status === 429;
    if (attempt >= 4 || (!(res instanceof Error) && res.status < 500 && !limited)) {
      throw new Error(`GET ${path} failed: ${status}`);
    }
    const backoff = limited ? retryAfterMs(res) : 2000 * 2 ** attempt;
    console.warn(`GET ${path} failed (${status}), retrying in ${Math.round(backoff / 1000)}s`);
    await sleep(backoff);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_WAIT_MS;
}

interface HeroStatsRow {
  id: number;
  localized_name: string;
  roles: string[];
  attack_type: "Melee" | "Ranged";
  primary_attr: string;
  [key: string]: unknown;
}

interface PatchRow {
  name: string;
  date: string;
}

interface LaneRoleRow {
  lane_role: number;
  games: string;
}

export interface PublicMatch {
  match_id: number;
  radiant_win: boolean;
  duration: number;
  lobby_type: number;
  game_mode: number;
  /** Unix seconds. */
  start_time: number;
  /** Average OpenDota rank tier of the ranked players (54 = Legend 4), when known. */
  avg_rank_tier?: number | null;
  radiant_team: number[];
  dire_team: number[];
}

function emptySnapshot(): Snapshot {
  return { generatedAt: "", heroes: {}, bracketStats: {}, matchups: {}, synergy: {}, laneRoles: {} };
}

function load(): Snapshot {
  if (!existsSync(SNAPSHOT_PATH)) return emptySnapshot();
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
}

function add(map: Record<string, GamesWins>, key: string, won: boolean) {
  const gw = (map[key] ??= { games: 0, wins: 0 });
  gw.games += 1;
  if (won) gw.wins += 1;
}

function scaleCounts(snapshot: Snapshot, factor: number) {
  const scale = (gw: GamesWins) => {
    gw.games = Math.round(gw.games * factor * 10) / 10;
    gw.wins = Math.round(gw.wins * factor * 10) / 10;
  };
  const matchupMaps = [snapshot.matchups, ...Object.values(snapshot.rankMatchups ?? {})];
  for (const matchups of matchupMaps) for (const row of Object.values(matchups)) Object.values(row).forEach(scale);
  for (const synergy of [snapshot.synergy, ...Object.values(snapshot.rankSynergy ?? {})]) Object.values(synergy).forEach(scale);
}

/** Fades all matchup and synergy counts by DECAY_PER_DAY for each day since the last run. */
export function decayCounts(snapshot: Snapshot, now: Date) {
  if (!snapshot.generatedAt) return;
  const days = Math.max(0, (now.getTime() - Date.parse(snapshot.generatedAt)) / DAY_MS);
  scaleCounts(snapshot, DECAY_PER_DAY ** days);
}

/**
 * Records the current patch. When it differs from the saved one, cuts the old
 * counts to PATCH_CARRYOVER and returns true.
 */
export function applyPatch(snapshot: Snapshot, latest: PatchRow): boolean {
  const changed = snapshot.patch !== undefined && snapshot.patch.name !== latest.name;
  if (changed) scaleCounts(snapshot, PATCH_CARRYOVER);
  snapshot.patch = { name: latest.name, startedAt: new Date(latest.date).toISOString() };
  return changed;
}

export function laneRolesDue(snapshot: Snapshot, now: Date): boolean {
  if (!snapshot.laneRolesAt) return true;
  return now.getTime() - Date.parse(snapshot.laneRolesAt) >= LANE_ROLES_MAX_AGE_DAYS * DAY_MS;
}

/** Adds one match to the counts. Returns false if the match is not a normal finished draft. */
export function countMatch(snapshot: Snapshot, m: PublicMatch): boolean {
  const teams = [m.radiant_team, m.dire_team];
  if (!GAME_MODES.has(m.game_mode) || (m.lobby_type !== 0 && m.lobby_type !== 7) || m.duration < MIN_DURATION_S) return false;
  if (teams.some((t) => t?.length !== 5 || t.includes(0))) return false;

  const targets = [{ matchups: snapshot.matchups, synergy: snapshot.synergy }];
  const medal = Math.floor((m.avg_rank_tier ?? 0) / 10);
  if (medal >= 1 && medal <= 8) {
    const group = rankGroup(medal as RankBracket);
    targets.push({
      matchups: ((snapshot.rankMatchups ??= {})[group] ??= {}),
      synergy: ((snapshot.rankSynergy ??= {})[group] ??= {}),
    });
  }

  for (const { matchups, synergy } of targets) {
    teams.forEach((team, side) => {
      const won = side === 0 ? m.radiant_win : !m.radiant_win;
      const enemies = teams[1 - side]!;
      for (const hero of team) {
        const row = (matchups[hero] ??= {});
        for (const enemy of enemies) add(row, String(enemy), won);
        for (const ally of team) if (ally > hero) add(synergy, `${hero}-${ally}`, won);
      }
    });
  }
  return true;
}

async function main() {
  const pagesArg = process.argv.indexOf("--pages");
  const maxPages = pagesArg > 0 ? Number(process.argv[pagesArg + 1]) : 200;
  const snapshot = load();
  const now = new Date();

  console.log("Hero stats...");
  const stats = await get<HeroStatsRow[]>("/heroStats");
  for (const h of stats) {
    snapshot.heroes[h.id] = {
      id: h.id,
      name: h.localized_name,
      roles: h.roles,
      attackType: h.attack_type,
      primaryAttr: h.primary_attr,
    } satisfies HeroInfo;
    const picks: number[] = [];
    const wins: number[] = [];
    for (let b = 1; b <= 8; b++) {
      picks.push(Number(h[`${b}_pick`] ?? 0));
      wins.push(Number(h[`${b}_win`] ?? 0));
    }
    snapshot.bracketStats[h.id] = { picks, wins };
  }

  const patches = await get<PatchRow[]>("/constants/patch");
  const latest = patches.reduce((a, b) => (Date.parse(b.date) > Date.parse(a.date) ? b : a));
  if (applyPatch(snapshot, latest)) {
    console.log(`New patch ${latest.name}: old matchups now count ${PATCH_CARRYOVER * 100}%.`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `new_patch=${latest.name}\n`);
  } else {
    console.log(`Patch ${latest.name}.`);
  }
  const patchStart = Date.parse(snapshot.patch!.startedAt) / 1000;

  if (laneRolesDue(snapshot, now)) {
    console.log(`Lane roles for ${stats.length} heroes...`);
    for (const h of stats) {
      const rows = await get<LaneRoleRow[]>(`/scenarios/laneRoles?hero_id=${h.id}`);
      const lanes: Snapshot["laneRoles"][string] = {};
      for (const r of rows) {
        const lane = String(r.lane_role) as "1" | "2" | "3" | "4";
        lanes[lane] = (lanes[lane] ?? 0) + Number(r.games);
      }
      snapshot.laneRoles[h.id] = lanes;
    }
    snapshot.laneRolesAt = now.toISOString();
  } else {
    console.log(`Lane roles are from ${snapshot.laneRolesAt}, keeping them.`);
  }

  decayCounts(snapshot, now);

  console.log(`Public matches (up to ${maxPages} pages)...`);
  const stopAt = snapshot.lastPublicMatchId ?? 0;
  let before: number | undefined;
  let newest = stopAt;
  let counted = 0;
  try {
    for (let page = 0; page < maxPages; page++) {
      if (remainingToday < DAILY_RESERVE) {
        console.log(`Stopping: only ${remainingToday} API requests left today.`);
        break;
      }
      const matches = await get<PublicMatch[]>(`/publicMatches${before ? `?less_than_match_id=${before}` : ""}`);
      if (matches.length === 0) break;
      for (const m of matches) {
        if (m.match_id <= stopAt || m.start_time < patchStart) continue;
        if (countMatch(snapshot, m)) {
          counted++;
          newest = Math.max(newest, m.match_id);
        }
      }
      before = Math.min(...matches.map((m) => m.match_id));
      // Pages go back in time, so stop at the last run or the patch release.
      if (before <= stopAt || matches.every((m) => m.start_time < patchStart)) break;
      if ((page + 1) % 25 === 0) console.log(`  ${page + 1} pages, ${counted} matches`);
    }
  } catch (err) {
    // Keep what was counted so far instead of losing the whole run. Public
    // matches are a sample anyway, so the skipped pages are not missed.
    if (counted === 0) throw err;
    console.warn(`Stopped early: ${(err as Error).message}`);
  }
  console.log(`Counted ${counted} new matches.`);

  snapshot.lastPublicMatchId = newest;
  snapshot.generatedAt = now.toISOString();
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot));
  console.log(`Saved ${SNAPSHOT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
