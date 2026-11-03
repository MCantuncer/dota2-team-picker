/**
 * Every hero's abilities and talents from the STRATZ constants, for the skill builds (see
 * skill-builds.ts): which abilities can take skill points, which is the ultimate, and the talent tiers.
 */
import type { HeroAbilities, Snapshot } from "../engine/types";
import { TALENT_LEVELS } from "../engine/types";
import type { TalentRow } from "./skill-build-choice";

const ATTRIBUTE_BONUS = "special_bonus_attributes";
/** STRATZ's slot for the ultimate (R). */
const ULTIMATE_SLOT = 6;

/** The constants query: game versions, every hero's ability slots and talents, and every ability's facts. */
export const CONSTANTS_QUERY = `{
  constants {
    gameVersions { id name }
    heroes { id abilities { slot abilityId } talents { slot abilityId } }
    abilities { id name language { displayName } stat { isUltimate isGrantedByScepter isGrantedByShard isInnate maxLevel } }
  }
}`;

export interface ConstantsAnswer {
  gameVersions?: { id: number; name: string }[] | null;
  heroes?:
    | {
        id: number;
        abilities?: { slot: number; abilityId: number }[] | null;
        talents?: { slot: number; abilityId: number }[] | null;
      }[]
    | null;
  abilities?:
    | {
        id: number;
        name?: string | null;
        language?: { displayName?: string | null } | null;
        stat?: {
          isUltimate?: boolean | null;
          isGrantedByScepter?: boolean | null;
          isGrantedByShard?: boolean | null;
          isInnate?: boolean | null;
          maxLevel?: number | null;
        } | null;
      }[]
    | null;
}

/**
 * Each hero's abilities that may take skill points, in slot order, and talents by tier. Slots 0 and 1
 * are the level 10 talent pair, 2 and 3 level 15, and so on.
 *
 * STRATZ's ability facts are patchy (Sven's God's Strength has no max level and is not marked as an
 * ultimate), so this only drops what surely takes no points: hidden slots, innate, Aghanim's and Shard
 * abilities, and abilities with a max level of 0 (Invoker's invoked spell slots). Which of the rest are
 * really learned, and their max levels when unknown, come from the guide players (see learnedHero).
 * The ultimate is the ability in slot 6, the R slot. Facets are left out: STRATZ answers facet 0 for
 * every guide player (Nov 2026), so a build covers all facets together.
 */
export function toHeroAbilities(constants: ConstantsAnswer): Record<string, HeroAbilities> {
  const abilities = new Map((constants.abilities ?? []).map((a) => [a.id, a]));
  const attributes = constants.abilities?.find((a) => a.name === ATTRIBUTE_BONUS);
  const out: Record<string, HeroAbilities> = {};
  for (const hero of constants.heroes ?? []) {
    const learnable = [...(hero.abilities ?? [])]
      .sort((a, b) => a.slot - b.slot)
      .flatMap((s) => {
        const a = abilities.get(s.abilityId);
        const stat = a?.stat ?? {};
        const name = a?.language?.displayName;
        if (!a || !name || a.name === "generic_hidden" || stat.maxLevel === 0) return [];
        if (stat.isInnate || stat.isGrantedByScepter || stat.isGrantedByShard) return [];
        return [
          {
            id: a.id,
            key: a.name ?? "",
            name,
            slot: s.slot,
            maxLevel: stat.maxLevel ?? 0,
            ultimate: s.slot === ULTIMATE_SLOT || !!stat.isUltimate,
          },
        ];
      });
    if (learnable.length === 0) continue;
    // The attribute bonus takes skill points on every hero; slot 0 keeps it out of the build's key.
    if (attributes?.language?.displayName) {
      learnable.push({
        id: attributes.id,
        key: ATTRIBUTE_BONUS,
        name: attributes.language.displayName,
        slot: 0,
        maxLevel: attributes.stat?.maxLevel ?? 0,
        ultimate: false,
      });
    }
    const talents: { id: number; name: string }[][] = TALENT_LEVELS.map(() => []);
    for (const t of [...(hero.talents ?? [])].sort((a, b) => a.slot - b.slot)) {
      const tier = Math.floor(t.slot / 2);
      if (tier < 0 || tier >= TALENT_LEVELS.length) continue;
      talents[tier]?.push({ id: t.abilityId, name: talentName(abilities.get(t.abilityId)?.language?.displayName) });
    }
    out[hero.id] = { abilities: learnable, talents };
  }
  return out;
}

/**
 * A talent's name as STRATZ writes it, like "+25% Great Cleave Damage", with spacing tidied. A name
 * with an unfilled value placeholder ("+{s:value} Damage") is dropped: the card shows the share only.
 */
export function talentName(raw: string | null | undefined): string {
  const name = (raw ?? "").replace(/\s+/g, " ").trim();
  return name.includes("{") ? "" : name;
}

/** The first STRATZ game version of a patch ("7.39" covers "7.39", "7.39b", ...), or null when STRATZ does not list it. */
export function patchGameVersion(versions: { id: number; name: string }[], patchName: string): number | null {
  const ids = versions.filter(
    (v) => v.name === patchName || new RegExp(`^${patchName.replace(".", "\\.")}[a-z]$`).test(v.name),
  );
  return ids.length ? Math.min(...ids.map((v) => v.id)) : null;
}

/**
 * A talent STRATZ's totals show for this hero but its constants left out (Sven's constants list 7 of 8)
 * goes to the one tier that has a single talent. Returns the fixed talents.
 */
export function fillMissingTalent(
  hero: HeroAbilities,
  totals: TalentRow[],
  names: Map<number, string>,
): HeroAbilities["talents"] {
  const known = new Set(hero.talents.flat().map((t) => t.id));
  const missing = [...new Set(totals.map((r) => r.abilityId))].filter((id) => !known.has(id) && id > 0);
  const open = hero.talents.map((pair, tier) => ({ pair, tier })).filter(({ pair }) => pair.length === 1);
  if (missing.length !== 1 || open.length !== 1) return hero.talents;
  return hero.talents.map((pair, tier) =>
    tier === open[0]?.tier ? [...pair, { id: missing[0] ?? 0, name: names.get(missing[0] ?? 0) ?? "" }] : pair,
  );
}

/** Fresh constants win, but a talent filled in by fillMissingTalent on an earlier run is kept while its tier is unchanged. */
export function mergeHeroAbilities(
  old: Snapshot["heroAbilities"],
  fresh: Record<string, HeroAbilities>,
): Record<string, HeroAbilities> {
  const out = { ...old, ...fresh };
  for (const [id, hero] of Object.entries(fresh)) {
    const before = old?.[id];
    if (!before) continue;
    out[id] = {
      ...hero,
      talents: hero.talents.map((pair, tier) => {
        const kept = before.talents[tier];
        return pair.length === 1 && kept?.length === 2 && kept.some((t) => t.id === pair[0]?.id) ? kept : pair;
      }),
    };
  }
  return out;
}
