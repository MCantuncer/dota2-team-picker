/**
 * The Item Build's neutral items: for each tier of the patch, the artifacts and enchantments this hero can get, in the
 * order players of this hero and position chose them this patch, with the minute the tier is usually crafted.
 *
 * At a craft the game offers a few artifacts at random (one per pool), so the order says which to take when it is
 * offered, not what to plan for. The numbers come from the most specific games with enough choices: this hero in this
 * position, then this hero in any position, then every hero in this position. A tier with none of them lists what
 * the game can offer, unranked.
 */
import type { EnchantGroup, NeutralChoices, NeutralItem, NeutralTierChoice, Position, Snapshot } from "./types";

/** Choices a tier needs from a group of games before its order is shown. */
export const MIN_TIER_PICKS = 12;
/** Enchantment choices needed; fewer games keep them (only games from 2026-11-25 on). */
export const MIN_ENCHANT_PICKS = 8;
/** Artifacts shown per tier. */
export const ARTIFACTS_SHOWN = 3;

/** Whose games a tier's numbers are from. */
export type NeutralSource = "hero-position" | "hero" | "position";

export interface NeutralOption {
  itemId: number;
  name: string;
  img: string;
  /** Percent of the source's choices of the tier, rounded; missing when the tier is unranked. */
  share?: number;
  /** An enchantment's level at this tier. */
  level?: number;
}

export interface NeutralPlanTier {
  tier: number;
  /** The game's earliest minute for the tier. */
  unlock: number;
  /** The usual minute of the tier's first craft in this source's parsed games, and the crafts it is from. */
  usual?: { minute: number; crafts: number };
  /** Whose choices the artifact order is from, and how many; missing when unranked. */
  from?: { source: NeutralSource; picks: number };
  artifacts: NeutralOption[];
  /** The enchantments offered to this hero at the tier, most chosen first when there are enough choices. */
  enchants: NeutralOption[];
  enchantFrom?: { source: NeutralSource; picks: number };
}

const GROUP: Record<string, EnchantGroup> = { str: "strength", agi: "agility", int: "intelligence", all: "universal" };

const option = (items: Record<string, NeutralItem>, itemId: number, extra: Partial<NeutralOption> = {}): NeutralOption[] => {
  const it = items[itemId];
  return it ? [{ itemId, name: it.name, img: it.img, ...extra }] : [];
};

/**
 * The neutral plan for a hero in a position, or null when the snapshot has no neutral pool. Pass the snapshot's
 * `neutrals`, `neutralChoices` and `heroes`.
 */
export function neutralPlan(data: Pick<Snapshot, "neutrals" | "neutralChoices" | "heroes">, heroId: number, position: Position): NeutralPlanTier[] | null {
  const pool = data.neutrals;
  if (!pool?.tiers.length) return null;
  const hero = data.neutralChoices?.heroes[heroId];
  const sources: [NeutralSource, NeutralChoices | undefined][] = [
    ["hero-position", hero?.[position]],
    ["hero", hero?.["0"]],
    ["position", data.neutralChoices?.positions[position]],
  ];
  const group = GROUP[data.heroes[heroId]?.primaryAttr ?? ""];
  return pool.tiers.map((t): NeutralPlanTier => {
    const key = String(t.tier);
    const inPool = new Set(t.pools.flat());
    const pick = (enough: (c: NeutralTierChoice) => boolean) => {
      for (const [source, choices] of sources) {
        const c = choices?.[key];
        if (c && enough(c)) return { source, choice: c };
      }
      return undefined;
    };
    const ranked = pick((c) => c.picks >= MIN_TIER_PICKS);
    const artifacts = ranked
      ? ranked.choice.artifacts
          .filter(([id]) => inPool.has(id))
          .slice(0, ARTIFACTS_SHOWN)
          .flatMap(([id, n]) => option(pool.items, id, { share: Math.round((n / ranked.choice.picks) * 100) }))
      : t.pools.flat().flatMap((id) => option(pool.items, id));

    // Offered to this hero: every hero's enchantments and its attribute's, each at the tier's level.
    const offered = new Map([...t.enchants.global, ...(group ? t.enchants[group] : [])]);
    const enchantTotal = (c: NeutralTierChoice) => c.enchants.filter(([id]) => offered.has(id)).reduce((n, [, k]) => n + k, 0);
    const byEnchant = pick((c) => enchantTotal(c) >= MIN_ENCHANT_PICKS);
    const chosen = new Map(byEnchant?.choice.enchants ?? []);
    const total = byEnchant ? enchantTotal(byEnchant.choice) : 0;
    const enchants = [...offered]
      .sort((a, b) => (chosen.get(b[0]) ?? 0) - (chosen.get(a[0]) ?? 0) || a[0] - b[0])
      .flatMap(([id, level]) => option(pool.items, id, { level, ...(byEnchant ? { share: Math.round(((chosen.get(id) ?? 0) / total) * 100) } : {}) }));

    // The usual minute: this hero's crafts when it has them, else its position's.
    const timed = sources.map(([, c]) => c?.[key]?.minute).find((m) => m !== undefined);
    return {
      tier: t.tier,
      unlock: t.minute,
      ...(timed ? { usual: { minute: timed[0], crafts: timed[1] } } : {}),
      ...(ranked ? { from: { source: ranked.source, picks: ranked.choice.picks } } : {}),
      artifacts,
      enchants,
      ...(byEnchant ? { enchantFrom: { source: byEnchant.source, picks: total } } : {}),
    };
  });
}
