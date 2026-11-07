/**
 * Downloads what the skill build of each hero and main position is picked from (see
 * skill-build-choice.ts): every hero's abilities and talents, recent STRATZ guide players' skill points
 * on this patch, and STRATZ's totals of when each ability is maxed and first taken.
 *
 * About 310 hero and position slices take about 52 list queries and 930 match queries a week, plus one
 * constants query per run, so the refresh is spread over runs: each run does at most `maxQueries` and
 * the oldest slices go first. Each slice is saved as it finishes, so a cut keeps the work done.
 *
 * The same match answers carry the guide player's item purchases and the game's length, for what high-rank
 * winners bought when a key item was late (item-paths.ts). No extra queries.
 */
import { bigItemCheck } from "../engine/item-odds";
import { itemPaths, type PathGame } from "../engine/item-paths";
import { chooseTimingSlice } from "../engine/item-timing-slice";
import type { KeyPaths, Position, Snapshot } from "../engine/types";
import { toSkillSlice, type LevelRow, type SliceTotals, type TalentRow } from "./skill-build-choice";
import type { GuidePlayer } from "./skill-sequence";
import { startRequests } from "./item-starts";
import {
  CONSTANTS_QUERY,
  fillMissingTalent,
  mergeHeroAbilities,
  patchGameVersion,
  talentName,
  toHeroAbilities,
  type ConstantsAnswer,
} from "./skill-abilities";

const SKILL_BUILDS_MAX_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * STRATZ gives only the latest 10 guides per guide list and ignores `skip`, so a slice asks for its
 * latest 10 plus the latest 10 against each of the most picked heroes: different games, about 70 in all.
 */
const GUIDES_PER_LIST = 10;
const OPPONENT_LISTS = 6;
const GUIDE_LISTS = 1 + OPPONENT_LISTS;
/** Guide matches asked for per slice; some are dropped (another position, an older patch, a short game). */
export const GUIDES_PER_SLICE = GUIDES_PER_LIST * GUIDE_LISTS;
/** Slices per list query: ten aliases each (seven guide lists and three totals), 60 aliases in all. */
export const SLICES_PER_LIST_QUERY = 6;
/** Match aliases per query. */
export const MATCHES_PER_QUERY = 20;
/** Rank bracket of the item timings the late paths' key items come from: Immortal, as guide players are. */
const PATHS_BRACKET = 8;
/** Queries per refresh run, so one run stays well under the STRATZ hourly limit. */
export const DEFAULT_MAX_QUERIES = 100;

/** One hero and position to refresh. */
export interface SkillRequest {
  heroId: number;
  position: Position;
}

const POSITION_NAMES = ["POSITION_1", "POSITION_2", "POSITION_3", "POSITION_4", "POSITION_5"];

// ---------------------------------------------------------------- what to refresh

/** Slices that are missing, older than a week, from an older patch or saved before item paths, oldest first. */
export function skillRequests(snapshot: Snapshot, versionId: number, now: Date): SkillRequest[] {
  if (!snapshot.positions) return [];
  const age = (r: SkillRequest) => {
    const slice = snapshot.skillBuilds?.[r.heroId]?.[r.position];
    if (!slice || slice.gameVersionId !== versionId || !slice.itemPaths) return Infinity;
    return now.getTime() - Date.parse(slice.at);
  };
  return startRequests(snapshot.positions)
    .map((r) => ({ r, age: age(r) }))
    .filter(({ age }) => age >= SKILL_BUILDS_MAX_AGE_DAYS * DAY_MS)
    .sort((a, b) => b.age - a.age)
    .map(({ r }) => r);
}

// ---------------------------------------------------------------- queries

function checkId(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Bad id ${id}`);
}

/** The most picked heroes over every rank, most first, to ask for guides against. */
export function mostPicked(snapshot: Pick<Snapshot, "bracketStats">, count = OPPONENT_LISTS + 1): number[] {
  return Object.entries(snapshot.bracketStats)
    .map(([id, stats]) => ({ id: Number(id), picks: stats.picks.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.picks - a.picks || a.id - b.id)
    .slice(0, count)
    .map((h) => h.id);
}

/**
 * Guide lists and STRATZ's totals per slice: g0_0 (latest guides), g0_1 to g0_6 (against each of
 * `opponents` but the hero itself), x0, n0, t0 for the first slice, then g1_0, ...
 */
export function listQuery(requests: SkillRequest[], opponents: number[]): string {
  if (requests.length === 0 || requests.length > SLICES_PER_LIST_QUERY) {
    throw new Error(`Expected 1 to ${SLICES_PER_LIST_QUERY} slices, got ${requests.length}`);
  }
  opponents.forEach(checkId);
  const lines = requests.flatMap((r, i) => {
    checkId(r.heroId);
    const position = POSITION_NAMES[r.position - 1];
    const against = ["", ...opponents.filter((id) => id !== r.heroId).map((id) => `, againstHeroId: ${id}`)];
    const where = `heroId: ${r.heroId}, positionIds: [${position}]`;
    return [
      ...against
        .slice(0, GUIDE_LISTS)
        .map(
          (filter, list) =>
            `    g${i}_${list}: guide(heroId: ${r.heroId}, positionId: ${position}${filter}, take: ${GUIDES_PER_LIST}) { guides { matchId steamAccountId } }`,
        ),
      `    x${i}: abilityMaxLevel(${where}) { abilityId level matchCount }`,
      `    n${i}: abilityMinLevel(${where}) { abilityId level matchCount }`,
      `    t${i}: talent(${where}) { abilityId matchCount winCount }`,
    ];
  });
  return `{\n  heroStats {\n${lines.join("\n")}\n  }\n}`;
}

/** A guide: the match and the guide player's Steam account. */
export interface GuideRef {
  matchId: number;
  steamAccountId: number;
}

/** One alias per match: m0, m1, ... with the game version, its length and the guide player with their purchases. */
export function matchesQuery(matches: GuideRef[]): string {
  if (matches.length === 0 || matches.length > MATCHES_PER_QUERY) {
    throw new Error(`Expected 1 to ${MATCHES_PER_QUERY} matches, got ${matches.length}`);
  }
  const lines = matches.map((m, i) => {
    checkId(m.matchId);
    checkId(m.steamAccountId);
    return `  m${i}: match(id: ${m.matchId}) { gameVersionId durationSeconds players(steamAccountId: ${m.steamAccountId}) { heroId position level isVictory abilities { abilityId time } stats { itemPurchases { time itemId } } } }`;
  });
  return `{\n${lines.join("\n")}\n}`;
}

// ---------------------------------------------------------------- answers

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Keeps the rows that have the expected shape; STRATZ is a third party. */
export function validLevelRows(rows: unknown): LevelRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is LevelRow => isNumber(r?.abilityId) && isNumber(r?.level) && isNumber(r?.matchCount));
}

export function validTalentRows(rows: unknown): TalentRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is TalentRow => isNumber(r?.abilityId) && isNumber(r?.matchCount))
    .map((r) => ({
      abilityId: r.abilityId,
      matchCount: r.matchCount,
      // Wins can't exceed games; a row without a usable count is kept without it.
      ...(isNumber(r.winCount) && r.winCount >= 0 && r.winCount <= r.matchCount ? { winCount: r.winCount } : {}),
    }));
}

/** Guides from one guide list answer (a list of lists of guides), one per match. */
export function guideRefs(answer: unknown): GuideRef[] {
  if (!Array.isArray(answer)) return [];
  const seen = new Set<number>();
  return answer
    .flatMap((list) => (Array.isArray(list?.guides) ? list.guides : []))
    .filter((g): g is GuideRef => {
      const ok =
        [g?.matchId, g?.steamAccountId].every((id) => Number.isSafeInteger(id) && id > 0) && !seen.has(g.matchId);
      if (ok) seen.add(g.matchId);
      return ok;
    })
    .map((g) => ({ matchId: g.matchId, steamAccountId: g.steamAccountId }));
}

/** The guide player from one match answer, or null when the shape is wrong or they played another hero. */
export function toGuidePlayer(answer: unknown, heroId: number): GuidePlayer | null {
  // Checked field by field below.
  const match = answer as { gameVersionId?: unknown; players?: unknown } | null;
  if (!match || !isNumber(match.gameVersionId) || !Array.isArray(match.players) || match.players.length !== 1)
    return null;
  // Checked field by field below.
  const p = match.players[0] as {
    heroId?: unknown;
    position?: unknown;
    level?: unknown;
    isVictory?: unknown;
    abilities?: unknown;
  };
  if (p?.heroId !== heroId || !isNumber(p.level) || !Array.isArray(p.abilities)) return null;
  const points = p.abilities.filter(
    (a): a is { abilityId: number; time: number } => isNumber(a?.abilityId) && isNumber(a?.time),
  );
  // A point without its id or time would shift every later level, so the build can't be trusted.
  if (points.length !== p.abilities.length) return null;
  const position = POSITION_NAMES.indexOf(p.position as string) + 1;
  return {
    gameVersionId: match.gameVersionId,
    // indexOf + 1 is 1 to 5 here.
    position: position > 0 ? (position as Position) : null,
    level: p.level,
    won: typeof p.isVictory === "boolean" ? p.isVictory : null,
    // Stable sort: STRATZ lists points in order; the time only fixes a list that isn't.
    points: [...points].sort((a, b) => a.time - b.time).map((a) => a.abilityId),
  };
}

/**
 * The guide player's purchases and the game's length from one match answer, for the late paths. Null when
 * either is missing: the game still counts for the skill build. A purchase without its id or time is left out.
 */
export function toPathGame(answer: unknown): PathGame | null {
  // Checked field by field below.
  const match = answer as { durationSeconds?: unknown; players?: unknown } | null;
  if (!match || !isNumber(match.durationSeconds) || !Array.isArray(match.players)) return null;
  // Checked field by field below.
  const stats = (match.players[0] as { stats?: { itemPurchases?: unknown } } | undefined)?.stats;
  if (!Array.isArray(stats?.itemPurchases)) return null;
  const items = stats.itemPurchases
    .filter((p): p is { itemId: number; time: number } => isNumber(p?.itemId) && isNumber(p?.time))
    .sort((a, b) => a.time - b.time)
    .map((p): [number, number] => [p.itemId, p.time]);
  return { duration: match.durationSeconds, items };
}

// ---------------------------------------------------------------- refresh

type Post = (query: string) => Promise<Record<string, unknown>>;

/**
 * Refreshes the oldest skill build slices, at most `maxQueries` STRATZ queries, writing each slice as
 * it finishes so a cut keeps the work done. Returns the counts and a line per slice's late paths for the log.
 */
export async function fetchSkillBuilds(snapshot: Snapshot, post: Post, now: Date, maxQueries = DEFAULT_MAX_QUERIES) {
  if (!snapshot.patch) throw new Error("Skill builds need the patch first");
  let queries = 1;
  // Checked below; every field in ConstantsAnswer is optional.
  const constants = (await post(CONSTANTS_QUERY)).constants as ConstantsAnswer | undefined;
  if (!constants?.heroes?.length || !constants.abilities?.length) throw new Error("STRATZ constants came back empty");
  const versionId = patchGameVersion(constants.gameVersions ?? [], snapshot.patch.name);
  if (versionId === null) throw new Error(`STRATZ has no game version for patch ${snapshot.patch.name}`);
  const heroes = toHeroAbilities(constants);
  const names = new Map((constants.abilities ?? []).map((a) => [a.id, talentName(a.language?.displayName)]));
  snapshot.heroAbilities = mergeHeroAbilities(snapshot.heroAbilities, heroes);

  const due = skillRequests(snapshot, versionId, now).filter((r) => heroes[r.heroId]);
  const opponents = mostPicked(snapshot);
  let done = 0;
  let matchQueries = 0;
  let largestMatchAnswer = 0;
  const paths: string[] = [];
  const items = snapshot.items ?? {};
  const isBig = bigItemCheck(items);
  for (let i = 0; i < due.length; i += SLICES_PER_LIST_QUERY) {
    const batch = due.slice(i, i + SLICES_PER_LIST_QUERY);
    // Each slice needs about GUIDES_PER_SLICE / MATCHES_PER_QUERY match queries after its list query.
    const needed = 1 + Math.ceil((batch.length * GUIDES_PER_SLICE) / MATCHES_PER_QUERY);
    if (queries + needed > maxQueries) break;
    // Each alias is checked by its reader (guideRefs, validLevelRows, validTalentRows).
    const lists = (await post(listQuery(batch, opponents))).heroStats as Record<string, unknown> | undefined;
    queries++;
    if (!lists) throw new Error("STRATZ skill builds failed: no heroStats in the answer");

    const wanted = batch.flatMap((r, j) => {
      const pages = [...Array(GUIDE_LISTS)].flatMap((_, k) => {
        const list: unknown = lists[`g${j}_${k}`];
        return Array.isArray(list) ? list : [];
      });
      return guideRefs(pages).map((g) => ({
        ...g,
        heroId: r.heroId,
        slice: j,
      }));
    });
    const players = new Map<number, { player: GuidePlayer; path: PathGame | null }[]>();
    for (let k = 0; k < wanted.length; k += MATCHES_PER_QUERY) {
      const chunk = wanted.slice(k, k + MATCHES_PER_QUERY);
      const answer = await post(matchesQuery(chunk));
      queries++;
      matchQueries++;
      largestMatchAnswer = Math.max(largestMatchAnswer, JSON.stringify(answer).length);
      chunk.forEach((m, j) => {
        const player = toGuidePlayer(answer[`m${j}`], m.heroId);
        const entry = player && { player, path: toPathGame(answer[`m${j}`]) };
        if (entry) players.set(m.slice, [...(players.get(m.slice) ?? []), entry]);
      });
    }

    batch.forEach((r, j) => {
      const totals: SliceTotals = {
        maxLevels: validLevelRows(lists[`x${j}`]),
        firstLevels: validLevelRows(lists[`n${j}`]),
        talents: validTalentRows(lists[`t${j}`]),
      };
      const hero = snapshot.heroAbilities?.[r.heroId];
      if (!hero) return;
      hero.talents = fillMissingTalent(hero, totals.talents, names);
      const games = players.get(j) ?? [];
      const slice = toSkillSlice(games.map((g) => g.player), r.position, totals, hero, versionId, now);
      // The same games the build uses (this position and patch), wins only: the paths say "high-rank wins".
      const wins = games.flatMap(({ player, path }) =>
        path && player.won === true && player.position === r.position && player.gameVersionId >= versionId ? [path] : [],
      );
      const timings = chooseTimingSlice(snapshot, r.heroId, r.position, PATHS_BRACKET)?.slice;
      slice.itemPaths = itemPaths(wins, timings, items, isBig);
      paths.push(pathsLine(r, wins.length, slice.itemPaths));
      ((snapshot.skillBuilds ??= {})[r.heroId] ??= {})[r.position] = slice;
      done++;
    });
  }
  return { done, due: due.length, queries, matchQueries, largestMatchAnswer, paths };
}

/** One slice's late paths for the log: each candidate key with its groups, for the coverage check. */
export function pathsLine(r: SkillRequest, wins: number, paths: Record<string, KeyPaths>): string {
  const keys = Object.entries(paths).map(([id, k]) => {
    const late = k.running - k.onTime;
    const path = k.path ? `path ${k.path.steps.length} steps` : "no path";
    return `${id} late ${k.late}: ${k.running} running, ${k.onTime} on time, ${late} late, ${path}`;
  });
  return `hero ${r.heroId} pos ${r.position}: ${wins} wins with purchases; ${keys.length ? keys.join("; ") : "no key item passes"}`;
}

/** How many slices have item paths saved, and how many of them have a late path for any key item. */
export function pathsCoverage(snapshot: Pick<Snapshot, "skillBuilds">): { slices: number; withPath: number } {
  const slices = Object.values(snapshot.skillBuilds ?? {}).flatMap((byPosition) =>
    Object.values(byPosition).flatMap((s) => (s?.itemPaths ? [s.itemPaths] : [])),
  );
  return { slices: slices.length, withPath: slices.filter((p) => Object.values(p).some((k) => k.path)).length };
}
