/**
 * The neutral items players chose this patch, counted from the saved ranked games (see eval-matches.ts). A parsed
 * game gives every craft: the last artifact and enchantment of each tier (a player can craft a tier again) and the
 * minute of the tier's first craft. Other games give only the neutral item they ended with, which is one choice of
 * its tier, so later tiers have more of those.
 */
import type { EvalMatch } from "./eval-matches";
import type { NeutralChoices, NeutralPool, NeutralTierChoice, Snapshot } from "../engine/types";

/** Kept per tier: the rest are rare choices no card shows. */
export const ARTIFACTS_KEPT = 6;
export const ENCHANTS_KEPT = 4;
/** Crafts with a minute a tier needs before its usual minute is kept. */
export const MIN_MINUTE_CRAFTS = 5;

interface Choice {
  tier: number;
  artifact: number;
  enchant?: number;
  minute?: number;
}

/** A pick's choices: one per crafted tier in a parsed game, else its end-of-game neutral item. */
export function pickChoices(pick: EvalMatch["picks"][number], pool: Pick<NeutralPool, "items">): Choice[] {
  const base = (id: number) => pool.items[id]?.brokenOf ?? id;
  const tierOf = (id: number) => pool.items[base(id)]?.tier;
  if (pick.crafts?.length) {
    const byTier = new Map<number, Choice>();
    for (const [artifact, enchant, minute] of pick.crafts) {
      const tier = tierOf(artifact);
      if (tier === undefined) continue;
      const first = byTier.get(tier)?.minute ?? minute;
      byTier.set(tier, { tier, artifact: base(artifact), ...(enchant ? { enchant } : {}), minute: first });
    }
    return [...byTier.values()];
  }
  const tier = pick.neutral === undefined ? undefined : tierOf(pick.neutral);
  if (pick.neutral === undefined || tier === undefined) return [];
  return [{ tier, artifact: base(pick.neutral), ...(pick.enchant ? { enchant: pick.enchant } : {}) }];
}

interface Tally {
  picks: number;
  artifacts: Map<number, number>;
  enchants: Map<number, number>;
  minutes: number[];
}

const add = (map: Map<number, number>, id: number) => map.set(id, (map.get(id) ?? 0) + 1);
const ranked = (map: Map<number, number>, max: number): [number, number][] => [...map].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, max);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

function toChoices(tiers: Map<number, Tally>): NeutralChoices {
  const out: NeutralChoices = {};
  for (const [tier, t] of [...tiers].sort((a, b) => a[0] - b[0])) {
    const choice: NeutralTierChoice = { picks: t.picks, artifacts: ranked(t.artifacts, ARTIFACTS_KEPT), enchants: ranked(t.enchants, ENCHANTS_KEPT) };
    if (t.minutes.length >= MIN_MINUTE_CRAFTS) choice.minute = [median(t.minutes), t.minutes.length];
    out[tier] = choice;
  }
  return out;
}

/**
 * Neutral choices of the games that started at or after `since` (Unix seconds), per hero and position ("0" for
 * every position) and per position over every hero. Artifacts not in the pool (an older patch's) are skipped.
 */
export function countNeutralChoices(games: EvalMatch[], since: number, pool: Pick<NeutralPool, "items">): NonNullable<Snapshot["neutralChoices"]> {
  const tallies = new Map<string, Map<number, Tally>>();
  const tally = (key: string, c: Choice) => {
    const tiers = tallies.get(key) ?? new Map<number, Tally>();
    tallies.set(key, tiers);
    const t: Tally = tiers.get(c.tier) ?? { picks: 0, artifacts: new Map(), enchants: new Map(), minutes: [] };
    tiers.set(c.tier, t);
    t.picks++;
    add(t.artifacts, c.artifact);
    if (c.enchant) add(t.enchants, c.enchant);
    if (c.minute !== undefined) t.minutes.push(c.minute);
  };
  let counted = 0;
  for (const game of games) {
    if (game.startTime < since) continue;
    let used = false;
    for (const pick of game.picks) {
      const choices = pickChoices(pick, pool);
      used ||= choices.length > 0;
      for (const position of pick.position ? ["0", String(pick.position)] : ["0"]) {
        for (const c of choices) {
          tally(`${pick.heroId}:${position}`, c);
          tally(`all:${position}`, c);
        }
      }
    }
    if (used) counted++;
  }
  const heroes: Record<string, Record<string, NeutralChoices>> = {};
  const positions: Record<string, NeutralChoices> = {};
  for (const [key, tiers] of tallies) {
    const [who, position] = key.split(":") as [string, string];
    if (who === "all") positions[position] = toChoices(tiers);
    else (heroes[who] ??= {})[position] = toChoices(tiers);
  }
  return { games: counted, heroes, positions };
}
