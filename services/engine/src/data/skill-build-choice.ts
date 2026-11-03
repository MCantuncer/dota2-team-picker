/**
 * Picks the skill build high-rank players used for one hero and position, from the skill points of
 * recent STRATZ guide players and STRATZ's totals over many more games.
 *
 * An order rebuilt from averages ("most common first point" and "most common max level" for each
 * ability on its own) is often a build nobody plays, so the build is a real guide player's: the games
 * are grouped by the order the abilities are maxed and which get an early point, and the biggest group
 * is used only when STRATZ's totals agree with it. Otherwise there is no build rather than a guess.
 */
import type { HeroAbilities, Position, SkillBuild, SkillBuildSlice } from "../engine/types";
import { BUILD_LEVELS, type GuidePlayer, getsPointEveryLevel, learnedHero, toSequence } from "./skill-sequence";

/** Fewer usable games than this and the slice has no build ("few-matches"). */
export const MIN_MATCHES = 20;
/** The chosen group must hold at least this share of the usable games. */
const MIN_GROUP_SHARE = 0.3;
/** An alternative must hold this share of the games, and of STRATZ's totals for the difference. */
const ALTERNATIVE_SHARE = 0.25;
/** Abilities with a point by this level count as taken early in a build's group key. */
const EARLY_LEVEL = 4;
/** The talent tiers' levels; players often take them a level later. */
export const TALENT_LEVELS = [10, 15, 20, 25];

/** A row of STRATZ's abilityMaxLevel or abilityMinLevel: games where an ability was maxed (or first taken) at a hero level. */
export interface LevelRow {
  abilityId: number;
  level: number;
  matchCount: number;
}

/** A row of STRATZ's talent totals: games where the talent was picked, and how many of them were won. */
export interface TalentRow {
  abilityId: number;
  matchCount: number;
  winCount?: number;
}

/** STRATZ's totals for one hero and position. */
export interface SliceTotals {
  maxLevels: LevelRow[];
  firstLevels: LevelRow[];
  talents: TalentRow[];
}

const share = (part: number, whole: number) => Math.round((part / whole) * 100) / 100;

/** Abilities the build is keyed on: not the ultimate, and not the attribute bonus (slot 0). */
function basicAbilities(hero: HeroAbilities) {
  return hero.abilities.filter((a) => !a.ultimate && a.slot >= 1);
}

/** The hero level of each basic ability's first point and of its max (0 when not reached by BUILD_LEVELS). */
function abilityLevels(levels: number[], hero: HeroAbilities) {
  return basicAbilities(hero).map((a) => {
    let count = 0;
    let first = 0;
    let max = 0;
    levels.slice(0, BUILD_LEVELS).forEach((id, i) => {
      if (id !== a.id) return;
      count++;
      if (count === 1) first = i + 1;
      if (count === a.maxLevel) max = i + 1;
    });
    return { id: a.id, first, max };
  });
}

function keyOf(maxOrder: number[], early: number[]): string {
  return `${maxOrder.join(">")}|${[...early].sort((x, y) => x - y).join(",")}`;
}

/**
 * A group key: the order basic abilities are maxed (ones not maxed last, by id) and which get a point
 * by EARLY_LEVEL, like Sven's Hammer, Cleave and Warcry by 4. Exact first-point levels split the games
 * into groups too small to trust (Cleave at 2, 3 or 4 is the same plan).
 */
export function buildKey(levels: number[], hero: HeroAbilities): string {
  const facts = abilityLevels(levels, hero);
  const maxOrder = [...facts].sort((a, b) => (a.max || 99) - (b.max || 99) || a.id - b.id).map((f) => f.id);
  return keyOf(
    maxOrder,
    facts.filter((f) => f.first > 0 && f.first <= EARLY_LEVEL).map((f) => f.id),
  );
}

/** The most common level per basic ability in STRATZ's totals. */
function modalLevels(rows: LevelRow[], hero: HeroAbilities): Map<number, number> {
  const basic = new Set(basicAbilities(hero).map((a) => a.id));
  const best = new Map<number, LevelRow>();
  for (const r of rows) {
    if (!basic.has(r.abilityId) || r.level < 1) continue;
    const seen = best.get(r.abilityId);
    if (!seen || r.matchCount > seen.matchCount) best.set(r.abilityId, r);
  }
  return new Map([...best].map(([id, r]) => [id, r.level]));
}

/** Whether STRATZ's totals give the same key from each ability's most common max level and first-point level. */
export function agreesWithTotals(key: string, totals: SliceTotals, hero: HeroAbilities): boolean {
  const maxLevels = modalLevels(totals.maxLevels, hero);
  const firstLevels = modalLevels(totals.firstLevels, hero);
  const basic = basicAbilities(hero);
  if (basic.some((a) => !firstLevels.has(a.id))) return false;
  // Like abilityLevels, an ability maxed after BUILD_LEVELS counts as not maxed (99), sorted by id.
  const maxBy = (id: number) => {
    const level = maxLevels.get(id) ?? 99;
    return level > BUILD_LEVELS ? 99 : level;
  };
  const maxOrder = [...basic].sort((a, b) => maxBy(a.id) - maxBy(b.id) || a.id - b.id).map((a) => a.id);
  const early = basic.filter((a) => (firstLevels.get(a.id) ?? 99) <= EARLY_LEVEL).map((a) => a.id);
  return key === keyOf(maxOrder, early);
}

/** Share of STRATZ's games where an ability was maxed at this level, one level either way. */
function maxLevelShare(rows: LevelRow[], abilityId: number, level: number): number {
  const mine = rows.filter((r) => r.abilityId === abilityId);
  const all = mine.reduce((n, r) => n + r.matchCount, 0);
  const near = mine.filter((r) => Math.abs(r.level - level) <= 1).reduce((n, r) => n + r.matchCount, 0);
  return all ? near / all : 0;
}

/**
 * The group's most typical real build (to BUILD_LEVELS): the one that differs from the others at the
 * fewest levels, with how many games took exactly it. Always one game's build, never a mix of several.
 */
export function typicalBuild(sequences: number[][]): { levels: number[]; count: number } {
  const builds = sequences.map((s) => s.slice(0, BUILD_LEVELS));
  const differences = (a: number[], b: number[]) => {
    let n = 0;
    for (let i = 0; i < BUILD_LEVELS; i++) if (a[i] !== b[i]) n++;
    return n;
  };
  const scored = builds.map((levels) => ({
    levels,
    distance: builds.reduce((n, other) => n + differences(levels, other), 0),
    count: builds.filter((other) => differences(levels, other) === 0).length,
  }));
  // Fewest differences, then the most exact copies, then the longest (a game that ended at 16 is cut short).
  scored.sort((a, b) => a.distance - b.distance || b.count - a.count || b.levels.length - a.levels.length);
  return { levels: scored[0]?.levels ?? [], count: scored[0]?.count ?? 0 };
}

/** Per talent tier: the talent picked in more of STRATZ's games, its share, and the level guide players usually took it. */
export function chooseTalents(
  totals: TalentRow[],
  sequences: number[][],
  hero: HeroAbilities,
): SkillBuildSlice["talents"] {
  const games = new Map<number, number>();
  const wins = new Map<number, number>();
  for (const r of totals) {
    games.set(r.abilityId, (games.get(r.abilityId) ?? 0) + r.matchCount);
    wins.set(r.abilityId, (wins.get(r.abilityId) ?? 0) + (r.winCount ?? 0));
  }
  const hasWins = totals.length > 0 && totals.every((r) => r.winCount !== undefined);
  return hero.talents.flatMap((pair, tier) => {
    // A tier missing a side (STRATZ's constants left one out) would read "100% pick this": skip it.
    if (pair.length !== 2) return [];
    const [top] = pair.map((t) => ({ id: t.id, games: games.get(t.id) ?? 0 })).sort((a, b) => b.games - a.games);
    const all = pair.reduce((n, t) => n + (games.get(t.id) ?? 0), 0);
    if (!top || !all) return [];
    const ids = new Set(pair.map((t) => t.id));
    const atLevel = new Map<number, number>();
    for (const s of sequences) {
      const at = s.findIndex((id) => ids.has(id));
      if (at >= 0) atLevel.set(at + 1, (atLevel.get(at + 1) ?? 0) + 1);
    }
    const [usual] = [...atLevel].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const level = usual?.[0] ?? TALENT_LEVELS[tier] ?? 0;
    const sides = pair.map((t) => ({ id: t.id, games: games.get(t.id) ?? 0, wins: wins.get(t.id) ?? 0 }));
    return [{ tier, id: top.id, share: share(top.games, all), games: all, level, ...(hasWins ? { sides } : {}) }];
  });
}

/** Turns one hero and position's guide players and totals into its build, alternative and talents. */
export function toSkillSlice(
  players: GuidePlayer[],
  position: Position,
  totals: SliceTotals,
  constantsHero: HeroAbilities,
  versionId: number,
  now: Date,
): SkillBuildSlice {
  const usable = players.filter((p) => p.position === position && p.gameVersionId >= versionId);
  const hero = learnedHero(constantsHero, usable);
  const everyLevel = getsPointEveryLevel(usable);
  const sequences = usable.map((p) => toSequence(p, hero, everyLevel)).filter((s): s is number[] => s !== null);
  const base = {
    at: now.toISOString(),
    gameVersionId: versionId,
    matches: sequences.length,
    talents: chooseTalents(totals.talents, sequences, hero),
  };
  if (sequences.length < MIN_MATCHES) return { ...base, none: "few-matches" };

  const groups = new Map<string, number[][]>();
  for (const s of sequences) {
    const key = buildKey(s, hero);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const ranked = [...groups].sort((a, b) => b[1].length - a[1].length);
  const toBuild = (list: number[][]): SkillBuild => {
    const typical = typicalBuild(list);
    return {
      levels: typical.levels,
      groupMatches: list.length,
      share: share(list.length, sequences.length),
      exactMatches: typical.count,
    };
  };
  const chosen = ranked.find(
    ([key, list]) => list.length >= sequences.length * MIN_GROUP_SHARE && agreesWithTotals(key, totals, hero),
  );
  if (!chosen) return { ...base, none: "no-agreement" };

  const build = toBuild(chosen[1]);
  const chosenLevels = abilityLevels(build.levels, hero);
  const alternative = ranked.find(([key, list]) => {
    if (key === chosen[0] || list.length < sequences.length * ALTERNATIVE_SHARE) return false;
    // The first ability maxed at another level must be maxed there in enough of STRATZ's games too.
    const differs = abilityLevels(typicalBuild(list).levels, hero).find(
      (mine, i) => mine.max > 0 && mine.max !== chosenLevels[i]?.max,
    );
    return !!differs && maxLevelShare(totals.maxLevels, differs.id, differs.max) >= ALTERNATIVE_SHARE;
  });
  return { ...base, build, ...(alternative ? { alternative: toBuild(alternative[1]) } : {}) };
}
