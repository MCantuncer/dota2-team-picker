/**
 * Every hero's talent tree as the game has it now, read from the game's own files, so a patch's talent changes show
 * on the next refresh. STRATZ's constants lag a patch (in 7.42 they still had 7.41's talents days after), so they no
 * longer decide the tree.
 *
 * - Which talents and their names with values: the game's files (talent-texts.ts), so letter patches show the same day;
 *   OpenDota's constants (built from the same files, but only when OpenDota updates them) for any name they can't fill.
 * - Ability ids, to match STRATZ's talent picks: OpenDota's ability ids (the game's own ids, the ones STRATZ uses),
 *   and the game's id list for a talent new to the patch that OpenDota doesn't list yet.
 * - Which side each talent sits on: the hero's file in the game (a mirror on GitHub). The hero lists its talents as
 *   Ability10 to Ability17; each level's pair is the next two, and the game shows the first of the two on the RIGHT
 *   (Anti-Mage at 25: Ability16 "-1s Blink Cooldown" right, Ability17 "-50s Mana Void Cooldown" left). OpenDota keeps
 *   the file's line order, which is not always the slot order (Lycan lists Ability17 before Ability16), so the slot
 *   numbers come from the file. Without the file a hero falls back to OpenDota's order.
 */
import { TALENT_LEVELS, type HeroAbilities, type Snapshot } from "../engine/types";
import { getOpenDota } from "./opendota";
import { talentName } from "./skill-abilities";
import {
  ABILITIES_FILE,
  ABILITY_IDS_FILE,
  GAME_FILES_URL,
  gameTalentTexts,
  parseKV,
  TOOLTIPS_FILE,
  type GameTalentTexts,
} from "./talent-texts";

/** The game files' hero scripts, one file per hero (Valve's files, mirrored by Dotabuff on every game update). */
export const HERO_FILES_URL = `${GAME_FILES_URL}scripts/npc/heroes/`;
/** The game's names are used only when they fill at least this share of the talents OpenDota lists: else a file came back cut. */
const MIN_GAME_NAME_SHARE = 0.9;
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
  /** Hero game name to its innate abilities' names, like ["Persecutor"]: talents name them, and the tree marks them. */
  innate: Map<string, string[]>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads OpenDota's /constants/heroes, hero_abilities, abilities and ability_ids answers. Throws when one is not an object. */
export function toTalentConstants(heroes: unknown, heroAbilities: unknown, abilities: unknown, abilityIds: unknown): TalentConstants {
  if (!isRecord(heroes) || !isRecord(heroAbilities) || !isRecord(abilities) || !isRecord(abilityIds)) {
    throw new Error("OpenDota constants are not objects");
  }
  const out: TalentConstants = { heroes: new Map(), talents: new Map(), names: new Map(), ids: new Map(), innate: new Map() };
  for (const h of Object.values(heroes)) {
    if (isRecord(h) && typeof h.id === "number" && typeof h.name === "string") out.heroes.set(h.id, h.name);
  }
  for (const [npc, entry] of Object.entries(heroAbilities)) {
    const list = isRecord(entry) && Array.isArray(entry.talents) ? entry.talents : [];
    const names = list.flatMap((t: unknown) => (isRecord(t) && typeof t.name === "string" ? [t.name] : []));
    out.talents.set(npc, names.filter((n) => n.startsWith("special_bonus_") && n !== ATTRIBUTE_BONUS));
    const keys = isRecord(entry) && Array.isArray(entry.abilities) ? entry.abilities : [];
    const innate = keys.flatMap((key: unknown) => {
      const a = typeof key === "string" ? abilities[key] : undefined;
      return isRecord(a) && a.is_innate === true && typeof a.dname === "string" && a.dname.trim() ? [a.dname.trim()] : [];
    });
    if (innate.length) out.innate.set(npc, innate);
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

/**
 * The constants with the game's talent names in place of OpenDota's, and the game's ids for talents OpenDota has no
 * id for. `renamed` counts the talents OpenDota names differently from the game (a patch OpenDota hasn't caught up
 * with). Null, with the reason, when the game fills too few of OpenDota's talents to be trusted.
 */
export function withGameTexts(
  c: TalentConstants,
  texts: GameTalentTexts,
): { constants: TalentConstants; renamed: number } | { problem: string } {
  const listed = [...new Set([...c.talents.values()].flat())];
  const filled = listed.filter((key) => texts.names.has(key)).length;
  if (filled < listed.length * MIN_GAME_NAME_SHARE) return { problem: `names for only ${filled} of ${listed.length} talents` };
  const renamed = listed.filter((key) => c.names.has(key) && texts.names.has(key) && texts.names.get(key) !== c.names.get(key)).length;
  const ids = new Map(texts.ids);
  for (const [key, id] of c.ids) ids.set(key, id);
  return { constants: { ...c, names: new Map([...c.names, ...texts.names]), ids }, renamed };
}

/** Every hero's tree by hero id, plus a line per hero that fell back or was left out. */
export interface GameTalents {
  trees: Record<string, TalentTree>;
  /** Innate ability names by hero id, for the heroes that have one. */
  innate: Record<string, string[]>;
  /** Heroes whose talents and sides came from their game file (the rest use OpenDota's list and order). */
  fromFiles: number;
  /** Talents whose name with values the game files changed from OpenDota's; null when OpenDota's names were kept. */
  renamed: number | null;
  notes: string[];
}

type GetText = (url: string) => Promise<string>;

/** A download, or the error it failed with: one failed file costs only what it carries. */
const tryText = (getText: GetText, url: string) => getText(url).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))));

/**
 * Builds the trees. Names come from the game files when they can be read (else OpenDota's). Each hero's talents and
 * sides come from its own file; a file that can't be read, or whose talents can't all be named, falls back to
 * OpenDota's list and order.
 */
export async function buildGameTalents(c: TalentConstants, getText: GetText): Promise<GameTalents> {
  const out: GameTalents = { trees: {}, innate: {}, fromFiles: 0, renamed: null, notes: [] };
  const heroes = [...c.heroes].filter(([, npc]) => c.talents.has(npc));
  const files = new Map<string, string | Error>();
  for (let i = 0; i < heroes.length; i += FILE_BATCH) {
    const batch = heroes.slice(i, i + FILE_BATCH);
    const texts = await Promise.all(batch.map(([, npc]) => tryText(getText, `${HERO_FILES_URL}${npc}.txt`)));
    batch.forEach(([, npc], j) => files.set(npc, texts[j]!)); // One answer per hero of the batch.
  }

  let names = c;
  const shared = await Promise.all([TOOLTIPS_FILE, ABILITIES_FILE, ABILITY_IDS_FILE].map((f) => tryText(getText, `${GAME_FILES_URL}${f}`)));
  const failed = shared.find((f) => f instanceof Error);
  if (failed instanceof Error) out.notes.push(`game talent names failed (${failed.message}), OpenDota's names`);
  else {
    const [tooltips, abilities, ids] = shared as string[]; // None is an Error, checked above.
    const heroFiles = [...files.values()].flatMap((f) => (typeof f === "string" ? [parseKV(f)] : []));
    const texts = gameTalentTexts(parseKV(tooltips!), [parseKV(abilities!), ...heroFiles], parseKV(ids!));
    const merged = withGameTexts(c, texts);
    if ("problem" in merged) out.notes.push(`game talent names: ${merged.problem}, OpenDota's names`);
    else {
      names = merged.constants;
      out.renamed = merged.renamed;
    }
  }

  for (const [id, npc] of heroes) {
    const listed = c.talents.get(npc) ?? [];
    const file = files.get(npc);
    const slots = typeof file === "string" ? talentSlots(file, npc) : [];
    const fromFile = toTree(slots, names);
    const innate = c.innate.get(npc);
    if (innate) out.innate[id] = innate;
    if ("tree" in fromFile) {
      out.fromFiles++;
      out.trees[id] = fromFile.tree;
      const newer = slots.filter((s) => !listed.includes(s));
      if (newer.length) out.notes.push(`${npc}: talents OpenDota doesn't list yet, from the game file: ${newer.join(", ")}`);
      continue;
    }
    out.notes.push(`${npc}: ${file instanceof Error ? `file failed (${file.message})` : `file unusable (${fromFile.problem})`}, OpenDota's order`);
    const built = toTree(listed, names);
    if ("tree" in built) out.trees[id] = built.tree;
    else out.notes.push(`${npc}: left as it was, ${built.problem}`);
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
 * Puts the trees on the snapshot's heroes, marked as from the game so STRATZ's constants leave them alone, with each
 * hero's innate ability names. Heroes without abilities yet are skipped (the skill builds add them). Returns how
 * many heroes' talents changed.
 */
export function applyGameTalents(snapshot: Snapshot, trees: Record<string, TalentTree>, innate: Record<string, string[]> = {}): number {
  let changed = 0;
  for (const [id, tree] of Object.entries(trees)) {
    const hero = snapshot.heroAbilities?.[id];
    if (!hero) continue;
    if (JSON.stringify(hero.talents) !== JSON.stringify(tree)) changed++;
    hero.talents = tree;
    hero.talentsFrom = "game";
    if (innate[id]) hero.innate = innate[id];
    else delete hero.innate;
  }
  return changed;
}
