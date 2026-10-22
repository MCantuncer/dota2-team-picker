/**
 * Builds data/snapshot.json from the free OpenDota API.
 *
 *   npm run fetch-data -- [--pages 200]
 *
 * Each run refreshes hero stats and lane roles, then reads recent public
 * matches page by page (100 per page) and adds their matchups and synergies
 * to the counts already in the snapshot. Old counts fade a little each run so
 * the data follows the current patch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GamesWins, HeroInfo, Snapshot } from "../engine/types";

const API = "https://api.opendota.com/api";
const SNAPSHOT_PATH = "data/snapshot.json";
/** The free API allows 60 requests a minute. */
const REQUEST_GAP_MS = 1100;
/** Share of old matchup and synergy counts kept on each run. */
const DECAY = 0.97;
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
    if (attempt >= 4 || (!(res instanceof Error) && res.status < 500 && res.status !== 429)) {
      throw new Error(`GET ${path} failed: ${status}`);
    }
    console.warn(`GET ${path} failed (${status}), retrying`);
    await sleep(2000 * 2 ** attempt);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function decay(gw: GamesWins) {
  gw.games = Math.round(gw.games * DECAY * 10) / 10;
  gw.wins = Math.round(gw.wins * DECAY * 10) / 10;
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

  for (const row of Object.values(snapshot.matchups)) Object.values(row).forEach(decay);
  Object.values(snapshot.synergy).forEach(decay);

  console.log(`Public matches (up to ${maxPages} pages)...`);
  const stopAt = snapshot.lastPublicMatchId ?? 0;
  let before: number | undefined;
  let newest = stopAt;
  let counted = 0;
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
  console.log(`Counted ${counted} new matches.`);

  snapshot.lastPublicMatchId = newest;
  snapshot.generatedAt = new Date().toISOString();
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
