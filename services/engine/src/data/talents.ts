/**
 * Every hero's talent tree as the game has it now, read from the game's own files, so a patch's talent changes show
 * on the next refresh. STRATZ's constants lag a patch (in 7.42 they still had 7.41's talents days after), so they no
 * longer decide the tree.
 *
 * - Which talents and their names with values: OpenDota's constants, built from the game files on every patch.
 * - Ability ids, to match STRATZ's talent picks: OpenDota's ability ids (the game's own ids, the ones STRATZ uses).
 * - Which side each talent sits on: the hero's file in the game (a mirror on GitHub). The hero lists its talents as
 *   Ability10 to Ability17; each level's pair is the next two, and the game shows the first of the two on the RIGHT
 *   (Anti-Mage at 25: Ability16 "-1s Blink Cooldown" right, Ability17 "-50s Mana Void Cooldown" left). OpenDota keeps
 *   the file's line order, which is not always the slot order (Lycan lists Ability17 before Ability16), so the slot
 *   numbers come from the file. Without the file a hero falls back to OpenDota's order.
 */
import { TALENT_LEVELS, type HeroAbilities, type Snapshot } from "../engine/types";
import { getOpenDota } from "./opendota";
import { talentName } from "./skill-abilities";

/** The game files' hero scripts, one file per hero (Valve's files, mirrored by Dotabuff on every game update). */
export const HERO_FILES_URL = "https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/scripts/npc/heroes/";
const TALENTS = TALENT_LEVELS.length * 2;
const ATTRIBUTE_BONUS = "special_bonus_attributes";
/** Hero files read at once. */
const FILE_BATCH = 8;
/** Fewer heroes than this means the constants came back cut short; Dota has over 120. */
const MIN_HEROES = 100;

export type TalentTree = HeroAbilities["talents"];

/** The parts of OpenDota's constants the trees need, checked where they come in. */
export interface TalentConstants {
  /** Hero id to the hero's game name, like 1 to "npc_dota_hero_antimage". */
  heroes: Map<number, string>;
  /** Hero game name to its talents' game names, in OpenDota's order. */
  talents: Map<string, string[]>;
  /** Talent game name to its name with values, like "-50s Mana Void Cooldown". */
  names: Map<string, string>;
  /** Talent game name to its ability id. */
  ids: Map<string, number>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads OpenDota's /constants/heroes, hero_abilities, abilities and ability_ids answers. Throws when one is not an object. */
export function toTalentConstants(heroes: unknown, heroAbilities: unknown, abilities: unknown, abilityIds: unknown): TalentConstants {
  if (!isRecord(heroes) || !isRecord(heroAbilities) || !isRecord(abilities) || !isRecord(abilityIds)) {
    throw new Error("OpenDota constants are not objects");
  }
  const out: TalentConstants = { heroes: new Map(), talents: new Map(), names: new Map(), ids: new Map() };
  for (const h of Object.values(heroes)) {
    if (isRecord(h) && typeof h.id === "number" && typeof h.name === "string") out.heroes.set(h.id, h.name);
  }
  for (const [npc, entry] of Object.entries(heroAbilities)) {
    const list = isRecord(entry) && Array.isArray(entry.talents) ? entry.talents : [];
    const names = list.flatMap((t: unknown) => (isRecord(t) && typeof t.name === "string" ? [t.name] : []));
    out.talents.set(npc, names.filter((n) => n.startsWith("special_bonus_") && n !== ATTRIBUTE_BONUS));
  }
  for (const [key, a] of Object.entries(abilities)) {
    if (isRecord(a) && typeof a.dname === "string") out.names.set(key, talentName(a.dname.replace(/%%/g, "%")));
  }
  // Keys are ids, sometimes several ("3060,1617"); the first id seen for a name wins.
  for (const [key, name] of Object.entries(abilityIds)) {
    const id = Number(key.split(",")[0]);
    if (typeof name === "string" && Number.isInteger(id) && id > 0 && !out.ids.has(name)) out.ids.set(name, id);
  }
  return out;
}

/**
 * The talents in a hero's game file by slot number (Ability10, Ability11, ...), from the hero's own block only: nested
 * blocks (Ability Draft's list, facets) also have Ability lines. Comments are skipped. Empty when the block is missing.
 */
export function talentSlots(file: string, npc: string): string[] {
  const found: [number, string][] = [];
  let depth = 0;
  let inHero = false;
  let pending: string | null = null;
  for (const raw of file.split(/\r?\n/)) {
    const line = raw.replace(/^((?:[^"/]|"[^"]*")*)\/\/.*$/, "$1").trim();
    const m = /^"([^"]*)"\s*(?:"([^"]*)")?/.exec(line);
    if (m) {
      const slot = /^Ability(\d+)$/.exec(m[1] ?? "");
      const value = m[2];
      if (inHero && depth === 2 && slot && value?.startsWith("special_bonus_") && value !== ATTRIBUTE_BONUS) {
        found.push([Number(slot[1]), value]);
      }
      pending = value === undefined ? (m[1] ?? null) : null;
    }
    // Braces outside quotes; a key may open its block on its own line or on the next.
    for (const ch of line.replace(/"[^"]*"/g, "")) {
      if (ch === "{") {
        depth++;
        if (depth === 2 && pending === npc) inHero = true;
        pending = null;
      } else if (ch === "}") {
        if (depth === 2) inHero = false;
        depth--;
      }
    }
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, name]) => name);
}

/**
 * A hero's tree from its talents in slot order: each level's pair as [left, right], the second of the two on the
 * left as in the game. Null, with the reason, when a talent has no id or name or the hero hasn't 8 talents.
 */
export function toTree(order: string[], c: TalentConstants): { tree: TalentTree } | { problem: string } {
  if (order.length !== TALENTS) return { problem: `${order.length} talents` };
  const talents = order.map((key) => ({ key, id: c.ids.get(key), name: c.names.get(key) }));
  const bad = talents.find((t) => !t.id || !t.name);
  if (bad) return { problem: `no ${bad.id ? "name" : "id"} for ${bad.key}` };
  const tree = TALENT_LEVELS.map((_, tier) =>
    [talents[2 * tier + 1], talents[2 * tier]].map((t) => ({ id: t?.id ?? 0, name: t?.name ?? "" })),
  );
  return { tree };
}

/** Every hero's tree by hero id, plus a line per hero that fell back or was left out. */
export interface GameTalents {
  trees: Record<string, TalentTree>;
  /** Heroes whose sides came from their game file (the rest use OpenDota's order). */
  fromFiles: number;
  notes: string[];
}

type GetText = (url: string) => Promise<string>;

/** Builds the trees. A hero's file that can't be read, or lists other talents than OpenDota, falls back to OpenDota's order. */
export async function buildGameTalents(c: TalentConstants, getText: GetText): Promise<GameTalents> {
  const out: GameTalents = { trees: {}, fromFiles: 0, notes: [] };
  const heroes = [...c.heroes].filter(([, npc]) => c.talents.has(npc));
  for (let i = 0; i < heroes.length; i += FILE_BATCH) {
    const batch = heroes.slice(i, i + FILE_BATCH);
    const files = await Promise.all(batch.map(([, npc]) => getText(`${HERO_FILES_URL}${npc}.txt`).catch((err: unknown) => err as Error)));
    batch.forEach(([id, npc], j) => {
      const listed = c.talents.get(npc) ?? [];
      const file = files[j];
      const slots = typeof file === "string" ? talentSlots(file, npc) : [];
      const same = slots.length === listed.length && slots.every((s) => listed.includes(s));
      if (same) out.fromFiles++;
      else out.notes.push(`${npc}: ${file instanceof Error ? `file failed (${file.message})` : "file differs from OpenDota"}, OpenDota's order`);
      const built = toTree(same ? slots : listed, c);
      if ("tree" in built) out.trees[id] = built.tree;
      else out.notes.push(`${npc}: left as it was, ${built.problem}`);
    });
  }
  return out;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Downloads the constants and the hero files and builds every hero's tree. Throws when the constants look cut short. */
export async function fetchGameTalents(): Promise<GameTalents> {
  // One after another: the client spaces its requests, and parallel calls would skip that.
  const heroes = await getOpenDota<unknown>("/constants/heroes");
  const heroAbilities = await getOpenDota<unknown>("/constants/hero_abilities");
  const abilities = await getOpenDota<unknown>("/constants/abilities");
  const abilityIds = await getOpenDota<unknown>("/constants/ability_ids");
  const c = toTalentConstants(heroes, heroAbilities, abilities, abilityIds);
  const talents = await buildGameTalents(c, getText);
  const count = Object.keys(talents.trees).length;
  if (count < MIN_HEROES) throw new Error(`Talents for only ${count} heroes`);
  return talents;
}

/**
 * Puts the trees on the snapshot's heroes, marked as from the game so STRATZ's constants leave them alone. Heroes
 * without abilities yet are skipped (the skill builds add them). Returns how many heroes' talents changed.
 */
export function applyGameTalents(snapshot: Snapshot, trees: Record<string, TalentTree>): number {
  let changed = 0;
  for (const [id, tree] of Object.entries(trees)) {
    const hero = snapshot.heroAbilities?.[id];
    if (!hero) continue;
    if (JSON.stringify(hero.talents) !== JSON.stringify(tree)) changed++;
    hero.talents = tree;
    hero.talentsFrom = "game";
  }
  return changed;
}
