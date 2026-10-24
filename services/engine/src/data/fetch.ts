/**
 * Builds data/snapshot.json from the free OpenDota API.
 *
 *   npm run fetch-data -- [--pages 200]
 *
 * Each run refreshes hero stats and lane roles, then reads recent public
 * matches page by page (100 per page) and adds their matchups and synergies
 * to the counts already in the snapshot. Old counts fade a little every day so
 * the data follows the current patch. Lane roles change slowly and cost one
 * request per hero, so they are refreshed once a week.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GamesWins, HeroInfo, Snapshot } from "../engine/types";

const API = "https://api.opendota.com/api";
const SNAPSHOT_PATH = "data/snapshot.json";
/** The free API allows 60 requests a minute; stay well below it. */
const REQUEST_GAP_MS = 1500;
/** How long to wait after a 429 when the API does not say. */
const RATE_LIMIT_WAIT_MS = 60_000;
/** Share of old matchup and synergy counts kept per day since the last run. */
const DECAY_PER_DAY = 0.97;
const LANE_ROLES_MAX_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ranked and unranked normal drafts: All Pick, Captains Mode, Random Draft, Single Draft, All Random, Captains Draft, Ranked All Pick. */
const GAME_MODES = new Set([1, 2, 3, 4, 5, 16, 22]);
const MIN_DURATION_S = 15 * 60;

let lastRequest = 0;

async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const res = await fetch(API + path).catch((err: unknown) => err as Error);
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

/** Fades all matchup and synergy counts by DECAY_PER_DAY for each day since the last run. */
export function decayCounts(snapshot: Snapshot, now: Date) {
  if (!snapshot.generatedAt) return;
  const days = Math.max(0, (now.getTime() - Date.parse(snapshot.generatedAt)) / DAY_MS);
  const factor = DECAY_PER_DAY ** days;
  const decay = (gw: GamesWins) => {
    gw.games = Math.round(gw.games * factor * 10) / 10;
    gw.wins = Math.round(gw.wins * factor * 10) / 10;
  };
  for (const row of Object.values(snapshot.matchups)) Object.values(row).forEach(decay);
  Object.values(snapshot.synergy).forEach(decay);
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

  teams.forEach((team, side) => {
    const won = side === 0 ? m.radiant_win : !m.radiant_win;
    const enemies = teams[1 - side]!;
    for (const hero of team) {
      const row = (snapshot.matchups[hero] ??= {});
      for (const enemy of enemies) add(row, String(enemy), won);
      for (const ally of team) if (ally > hero) add(snapshot.synergy, `${hero}-${ally}`, won);
    }
  });
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
      const matches = await get<PublicMatch[]>(`/publicMatches${before ? `?less_than_match_id=${before}` : ""}`);
      if (matches.length === 0) break;
      for (const m of matches) {
        if (m.match_id <= stopAt) continue;
        if (countMatch(snapshot, m)) {
          counted++;
          newest = Math.max(newest, m.match_id);
        }
      }
      before = Math.min(...matches.map((m) => m.match_id));
      if (before <= stopAt) break;
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
