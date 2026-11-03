/**
 * The skill order and full talent tree on a player's Game Story card, each with its reason.
 *
 * The skill order is the build most high-rank winners used for this hero and position (weekly
 * guide games, see data/skill-build-choice.ts; guides are wins only). The talent tree is decided
 * per tier for this game from the live matchup lookup (see matchup-talents.ts) once it has
 * answered; until then each tier shows the usual pick, labelled as general. Every line says which
 * games its numbers come from.
 *
 * For the web card: highlight `pick` in each tier and show `result` only as its label. A
 * "leaning" tier keeps the usual pick and says which way the games lean.
 */
import {
  chooseMatchupTalents,
  type MatchupGame,
  oddsLabel,
  SAMPLE_NOTE,
  tierReason,
  type TierChoice,
  type TalentResult,
} from "./matchup-talents";
import { TALENT_LEVELS, type Position, type SkillBuildSlice, type Snapshot } from "./types";

/**
 * Where the talent tree's numbers come from: the matchup games ("ready"), or the usual talents
 * while they load, when the lookup failed, or when the viewer must sign in to run it.
 */
export type SkillLive = "ready" | "loading" | "unavailable" | "sign-in";

export interface TalentTier {
  tier: number;
  /** The level players usually take it (can be later than the tier's level), or the tier's level without data. */
  level: number;
  /** Both talents, left then right as in the game. */
  options: { id: number; name: string }[];
  /** The one to take in this game, or null when there is no usual pick to show. */
  pick: number | null;
  /** The one most players take in general, or null as for `pick`. */
  usual: number | null;
  /** "general" while the matchup games aren't in, or when none reached this tier; "no-data" when no pick is shown. */
  result: TalentResult | "general" | "no-data";
  reason: string;
  /** "1.8x the odds · 42 games", small under the reason, when the matchup games lean to the other talent. */
  odds?: string;
}

export interface SkillPlan {
  /** The ability or talent id at each level from 1 (0 for no point), or null when there is no build. */
  levels: number[] | null;
  /**
   * Ability and talent names by id, for the card's boxes (keys are strings once sent as JSON).
   * The weekly alternative build isn't shown on the card yet, so it isn't passed on.
   */
  names: Record<number, string>;
  /** Why this order, with its numbers; or why there is none. */
  buildReason: string;
  /** Every tier of the hero's tree, level 10 first. */
  talents: TalentTier[];
  /** Shown once under the tree when matchup games reached at least one tier. */
  note?: string;
  live: SkillLive;
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

function buildReason(slice: SkillBuildSlice | undefined, patch: string): string {
  if (!slice) return "No high-rank skill builds for this hero in this position yet.";
  const { build, matches } = slice;
  if (build) {
    return `${build.groupMatches} of ${matches} high-rank wins ${patch} (${pct(build.share)}) used this order, and the wider totals agree.`;
  }
  if (slice.none === "few-matches") return `Only ${matches} high-rank wins ${patch}, too few to show an order.`;
  return `High-rank winners don't agree on one order ${patch} (${matches} wins), so none is shown.`;
}

/** The newest game version among the weekly slices: older slices are from last patch. */
export function latestSkillVersion(builds: Snapshot["skillBuilds"]): number {
  let latest = 0;
  for (const byPosition of Object.values(builds ?? {})) {
    for (const s of Object.values(byPosition ?? {})) latest = Math.max(latest, s?.gameVersionId ?? 0);
  }
  return latest;
}

function noData(tier: number, options: TalentTier["options"]): TalentTier {
  const level = TALENT_LEVELS[tier] ?? 10 + 5 * tier;
  return {
    tier,
    level,
    options,
    pick: null,
    usual: null,
    result: "no-data",
    reason: `No talent picks recorded for level ${level} yet, so there is no usual pick.`,
  };
}

const tookAny = (c: TierChoice) => c.sides.some((s) => s.wins + s.losses > 0);

/**
 * The card's skill plan for one of our heroes, or null when the snapshot has no abilities for it.
 * `matchup` is the live lookup's games for this hero against the enemies: undefined while loading,
 * null when the lookup failed or was refused, "sign-in" when the viewer isn't signed in, empty when
 * it found no games. Only "ready" tiers say more than the usual share; the card says the state once.
 */
export function skillPlan(
  data: Pick<Snapshot, "heroAbilities" | "skillBuilds">,
  heroId: number,
  position: Position,
  enemies: string[],
  matchup: MatchupGame[] | null | undefined | "sign-in",
): SkillPlan | null {
  const hero = data.heroAbilities?.[heroId];
  if (!hero) return null;
  const found = data.skillBuilds?.[heroId]?.[position];
  const patch = found && found.gameVersionId < latestSkillVersion(data.skillBuilds) ? "last patch" : "this patch";
  const names: Record<number, string> = {};
  for (const a of hero.abilities) names[a.id] = a.name;
  for (const t of hero.talents.flat()) names[t.id] = t.name;
  const name = (id: number) => names[id] || "an unnamed talent";

  // A weekly talent that isn't in the hero's tree (a patch changed it) can't be shown or compared.
  const general = (found?.talents ?? []).filter((g) => hero.talents[g.tier]?.some((o) => o.id === g.id));
  const games = Array.isArray(matchup) ? matchup : null;
  const live: SkillLive =
    matchup === undefined ? "loading" : matchup === null ? "unavailable" : games ? "ready" : "sign-in";
  const choices = (games ? chooseMatchupTalents(hero.talents, general, games) : []).filter(tookAny);
  const waiting = games ? " No games against these heroes reached this level, so this is the usual pick." : "";

  const talents = hero.talents.flatMap((options, tier): TalentTier[] => {
    if (options.length !== 2) return [];
    const g = general.find((t) => t.tier === tier);
    if (!g) return [noData(tier, options)];
    const base = { tier, level: g.level, options, usual: g.id };
    const c = choices.find((x) => x.tier === tier);
    if (c) {
      const odds = oddsLabel(c);
      const reason = tierReason(c, name, enemies, g);
      return [{ ...base, pick: c.pick, result: c.result, reason, ...(odds ? { odds } : {}) }];
    }
    const reason = `${pct(g.share)} of ${g.games} recent games took ${name(g.id)}.${waiting}`;
    return [{ ...base, pick: g.id, result: "general", reason }];
  });

  return {
    levels: found?.build?.levels ?? null,
    names,
    buildReason: buildReason(found, patch),
    talents,
    ...(choices.length ? { note: SAMPLE_NOTE } : {}),
    live,
  };
}
