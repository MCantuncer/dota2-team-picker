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
 * Pick-phase counts are rebuilt each run from the saved ranked games (see
 * collect.ts). Item builds cost one request per hero too and are refreshed
 * once a day (see items.ts), and so are item timings, start items and boots from STRATZ (see
 * item-timings.ts and item-starts.ts).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { findHardCounters, HOLD_RUNS, holdHardCounters } from "../engine/data-hard-counters";
import { positionFit } from "../engine/positions";
import { Engine } from "../engine/score";
import { getOpenDota as get, requestsLeftToday } from "./opendota";
import { loadEvalGames, monthPaths } from "./eval-store";
import { fetchItemStarts } from "./item-starts";
import { fetchItemTimings, itemTimingsDue } from "./item-timings";
import { fetchItems, itemsDue } from "./items";
import { countPickPhases } from "./pick-phase";
import { fetchSkillBuilds, pathsCoverage } from "./skill-builds";
import { fetchPositions, postStratz } from "./stratz";
import { applyStratzCounts, fetchStratzCounts } from "./stratz-matchups";
import { fetchLaneOutcomes, lanesDue, MIN_LANE_GAMES } from "./stratz-lanes";
import { rankGroup, type GamesWins, type HeroInfo, type RankBracket, type Snapshot } from "../engine/types";

const SNAPSHOT_PATH = "data/snapshot.json";
/** Share of old matchup and synergy counts kept per day since the last run. */
const DECAY_PER_DAY = 0.99;
/**
 * Share of the counts kept when a new patch comes out. Most matchups survive a
 * patch, so the old data is a better start than nothing while new games come in.
 */
const PATCH_CARRYOVER = 0.25;
const LANE_ROLES_MAX_AGE_DAYS = 7;
/** STRATZ matchups older than this get a warning in the refresh log (4 refreshes a day). */
const STRATZ_STALE_HOURS = 48;
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
  // STRATZ counts are replaced whole on every refresh, so they never fade.
  if (snapshot.matchupsFrom?.source === "stratz") return;
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

/** Finds this run's hard counters in the counts and keeps those that held (see data-hard-counters.ts). */
export function updateDataHardCounters(snapshot: Snapshot) {
  const found = findHardCounters(new Engine(snapshot, { hardCounters: [] }), snapshot);
  const { list, streaks } = holdHardCounters(found, snapshot.hardCounterStreaks);
  snapshot.dataHardCounters = list;
  snapshot.hardCounterStreaks = streaks;
  console.log(`Hard counters from the data: ${found.length} past the line, ${list.length} held for ${HOLD_RUNS} runs.`);
}

/** Item paths above this many KB gzipped get a warning; they are never dropped for size (two-path plan). */
const ITEM_PATHS_WARN_KB = 60;

/** Each refreshed slice's late paths, the largest match answer, and the coverage and size of all paths. */
function logItemPaths(snapshot: Snapshot, counts: { largestMatchAnswer: number; paths: string[] }) {
  for (const line of counts.paths) console.log(`  Item paths, ${line}`);
  console.log(`Largest skill build match answer: about ${(counts.largestMatchAnswer / 1024).toFixed(1)} KB.`);
  // Shaped as the snapshot holds them, hero then position, so the size is what ships.
  const all = Object.fromEntries(
    Object.entries(snapshot.skillBuilds ?? {}).map(([hero, byPosition]) => [
      hero,
      Object.fromEntries(Object.entries(byPosition).map(([position, s]) => [position, s?.itemPaths])),
    ]),
  );
  const kb = gzipSync(JSON.stringify(all)).length / 1024;
  const { slices, withPath } = pathsCoverage(snapshot);
  console.log(`Item paths: ${withPath} of ${slices} slices have a late path, ${kb.toFixed(1)} KB gzipped.`);
  if (kb > ITEM_PATHS_WARN_KB) console.warn(`::warning::Item paths are ${kb.toFixed(1)} KB gzipped, over ${ITEM_PATHS_WARN_KB} KB.`);
}

/** Prints games per position and the heroes whose main position STRATZ corrects, as a sanity check. */
function logPositions(snapshot: Snapshot) {
  const positions = snapshot.positions ?? {};
  const totals = [0, 0, 0, 0, 0];
  for (const games of Object.values(positions)) games.forEach((g, i) => (totals[i]! += g));
  console.log(`Positions for ${Object.keys(positions).length} heroes, games per position: ${totals.join(" / ")}`);
  const main = (fit: Record<number, number>) => [1, 2, 3, 4, 5].reduce((a, b) => (fit[b]! > fit[a]! ? b : a));
  const changed = Object.values(snapshot.heroes).flatMap((h) => {
    const before = main(positionFit(h, snapshot.laneRoles[h.id]));
    const after = main(positionFit(h, snapshot.laneRoles[h.id], positions[h.id]));
    return before === after ? [] : [`${h.name} ${before}->${after}`];
  });
  console.log(`Main position corrected for ${changed.length} heroes: ${changed.join(", ")}`);
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

  const stratzToken = process.env.STRATZ_TOKEN;
  if (stratzToken) {
    console.log("Positions from STRATZ...");
    try {
      snapshot.positions = await fetchPositions(stratzToken);
      snapshot.positionsAt = now.toISOString();
      logPositions(snapshot);
    } catch (err) {
      // Positions are an extra; keep the last ones (or lane roles) and go on.
      console.warn(`::warning::${(err as Error).message}`);
    }
  } else {
    console.log("No STRATZ_TOKEN, positions come from lane roles.");
  }

  if (itemsDue(snapshot, now)) {
    console.log("Item builds...");
    try {
      await fetchItems(snapshot, get, now);
      console.log(`Item builds for ${Object.keys(snapshot.itemBuilds ?? {}).length} heroes.`);
    } catch (err) {
      // Item builds are an extra; keep the last ones and go on.
      console.warn(`::warning::${(err as Error).message}`);
    }
  } else {
    console.log(`Item builds are from ${snapshot.itemsAt}, keeping them.`);
  }

  if (stratzToken && itemTimingsDue(snapshot, now)) {
    console.log("Item timings from STRATZ...");
    try {
      await fetchItemTimings(snapshot, (query) => postStratz(stratzToken, query, "item timings"), now);
      const kb = (gzipSync(JSON.stringify(snapshot.itemTimings)).length / 1024).toFixed(1);
      console.log(`Item timings for ${Object.keys(snapshot.itemTimings ?? {}).length} heroes, ${kb} KB gzipped.`);
    } catch (err) {
      // Item timings are an extra; keep the last ones and go on.
      console.warn(`::warning::${(err as Error).message}`);
    }
    console.log("Start items and boots from STRATZ...");
    try {
      await fetchItemStarts(snapshot, (query) => postStratz(stratzToken, query, "start items"));
      console.log(`Start items for ${Object.keys(snapshot.itemStarts ?? {}).length} heroes.`);
    } catch (err) {
      // Start items are an extra too; keep the last ones.
      console.warn(`::warning::${(err as Error).message}`);
    }
  } else if (stratzToken) {
    console.log(`Item timings are from ${snapshot.itemTimingsAt}, keeping them.`);
  }

  if (stratzToken) {
    console.log("Skill builds from STRATZ guide matches...");
    try {
      const counts = await fetchSkillBuilds(snapshot, (query) => postStratz(stratzToken, query, "skill builds"), now);
      const kb = (gzipSync(JSON.stringify(snapshot.skillBuilds ?? {})).length / 1024).toFixed(1);
      console.log(
        `Skill builds: ${counts.done} of ${counts.due} due slices refreshed in ${counts.queries} queries (${counts.matchQueries} for matches), ${kb} KB gzipped.`,
      );
      logItemPaths(snapshot, counts);
    } catch (err) {
      // Skill builds are an extra; keep the slices done so far and go on. The next run resumes.
      console.warn(`::warning::${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("Pick phases from the saved ranked games...");
  try {
    const nowS = Math.floor(now.getTime() / 1000);
    const games = (await Promise.all(monthPaths(patchStart, nowS).map(loadEvalGames))).flat();
    const thisPatch = games.filter((g) => g.startTime >= patchStart);
    snapshot.pickPhase = countPickPhases(thisPatch);
    console.log(`Pick phases from ${thisPatch.length} games.`);
  } catch (err) {
    // Pick phases are an extra; keep the last ones and go on.
    console.warn(`::warning::${(err as Error).message}`);
  }

  if (stratzToken) {
    console.log("Matchups and synergy from STRATZ...");
    try {
      const heroIds = Object.values(snapshot.heroes).map((h) => h.id).sort((a, b) => a - b);
      const counts = await fetchStratzCounts(heroIds, (query) => postStratz(stratzToken, query, "matchups"));
      applyStratzCounts(snapshot, counts, now);
      const pairs = Object.values(counts.matchups).reduce((n, row) => n + Object.keys(row).length, 0);
      const games = Object.values(counts.matchups).flatMap((row) => Object.values(row).map((gw) => gw.games));
      games.sort((a, b) => a - b);
      console.log(`STRATZ matchups: ${pairs} pairs, median ${games[Math.floor(games.length / 2)] ?? 0} games per pair.`);
    } catch (err) {
      // Keep the last counts, whichever source they came from, and go on.
      console.warn(`::warning::${(err as Error).message}`);
    }
  }
  if (stratzToken && lanesDue(snapshot, now)) {
    console.log("Lane results from STRATZ...");
    try {
      const heroIds = Object.values(snapshot.heroes).map((h) => h.id).sort((a, b) => a - b);
      snapshot.laneOutcomes = await fetchLaneOutcomes(heroIds, (query) => postStratz(stratzToken, query, "lanes"));
      snapshot.laneOutcomesAt = now.toISOString();
      const pairs = Object.values(snapshot.laneOutcomes["0"] ?? {}).reduce((n, row) => n + Object.keys(row).length, 0);
      console.log(`STRATZ lanes: ${pairs} pairs with ${MIN_LANE_GAMES}+ games.`);
    } catch (err) {
      // Lane results are an extra; keep the last ones and go on.
      console.warn(`::warning::${(err as Error).message}`);
    }
  }
  if (snapshot.matchupsFrom?.source === "stratz") {
    const hours = (now.getTime() - Date.parse(snapshot.matchupsFrom.at)) / 3_600_000;
    if (hours > STRATZ_STALE_HOURS) console.warn(`::warning::STRATZ matchups are ${Math.round(hours)} hours old.`);
  }

  // Our own sample of public matches is only counted while the matchups don't come from STRATZ.
  const useSample = snapshot.matchupsFrom?.source !== "stratz";
  decayCounts(snapshot, now);

  console.log(useSample ? `Public matches (up to ${maxPages} pages)...` : "Matchups are from STRATZ, skipping public matches.");
  const stopAt = snapshot.lastPublicMatchId ?? 0;
  let before: number | undefined;
  let newest = stopAt;
  let counted = 0;
  try {
    for (let page = 0; useSample && page < maxPages; page++) {
      if (requestsLeftToday() < DAILY_RESERVE) {
        console.log(`Stopping: only ${requestsLeftToday()} API requests left today.`);
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
  updateDataHardCounters(snapshot);
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
