/**
 * Talent names with their values, read from the game's own files, so a patch's talent changes (letter patches too)
 * show on the next refresh. OpenDota's constants are built from the same files but only when OpenDota updates them:
 * 7.42a changed 7 heroes' talents and OpenDota still had 7.42's values days later.
 *
 * - The text: abilities_english.txt, "DOTA_Tooltip_ability_<talent>", like "+{s:bonus_curse_dps} Curse of Avernus DPS".
 * - The values: the talent's own AbilityValues ("value" "4.5"), or the ability value it changes, which names the talent
 *   inside its block ("curse_dps" { "value" "12 20 28 36"  "special_bonus_unique_abaddon_5" "+20" }), read as
 *   "bonus_curse_dps". The sign is in the text, so the value's own sign goes.
 * - The ids: npc_ability_ids.txt, for talents new to the patch that OpenDota doesn't list yet.
 */

/** A Valve KeyValues file: each key holds a string or a block. A key seen twice keeps its last value. */
export type KV = { [key: string]: string | KV };

/** The game files' folder, mirrored by Dotabuff on every game update. */
export const GAME_FILES_URL = "https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/";
export const ABILITIES_FILE = "scripts/npc/npc_abilities.txt";
export const ABILITY_IDS_FILE = "scripts/npc/npc_ability_ids.txt";
export const TOOLTIPS_FILE = "resource/localization/abilities_english.txt";

/**
 * Reads a KeyValues file: quoted or bare tokens, braces, `//` comments and platform tags like [$WIN32], which are
 * skipped. A brace that doesn't match is ignored rather than thrown on: a wrong value only drops that one talent.
 */
export function parseKV(text: string): KV {
  const root: KV = {};
  const stack: KV[] = [root];
  let key: string | null = null;
  const token = /"((?:[^"\\]|\\.)*)"|(\/\/[^\n]*)|([{}])|(\[[^\]\n]*\])|([^\s"{}]+)/g;
  for (let m = token.exec(text); m; m = token.exec(text)) {
    const [, quoted, comment, brace, tag, bare] = m;
    if (comment !== undefined || tag !== undefined) continue;
    const top = stack[stack.length - 1]!; // The stack never empties: a closing brace on the root is ignored.
    if (brace === "{") {
      const block: KV = {};
      if (key !== null) top[key] = block;
      stack.push(block);
      key = null;
    } else if (brace === "}") {
      if (stack.length > 1) stack.pop();
      key = null;
    } else {
      const word = quoted ?? bare ?? "";
      if (key === null) key = word;
      else {
        top[key] = word;
        key = null;
      }
    }
  }
  return root;
}

const isBlock = (v: string | KV | undefined): v is KV => typeof v === "object";
const isTalent = (name: string) => name.startsWith("special_bonus_") && name !== "special_bonus_attributes";

/** A value as text, or the "value" inside a value block. */
function valueOf(v: string | KV | undefined): string | undefined {
  if (typeof v === "string") return v;
  return isBlock(v) && typeof v.value === "string" ? v.value : undefined;
}

/**
 * Every talent's values, by talent then value name, from the given files' ability blocks wherever they sit (hero files
 * nest them). Its own AbilityValues keep their names; a value it changes on another ability is "bonus_<value name>".
 */
export function talentValues(files: KV[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const set = (talent: string, name: string, value: string) => {
    let values = out.get(talent);
    if (!values) out.set(talent, (values = new Map()));
    values.set(name, value);
  };
  /** A value block that names talents: under AbilityValues, or on the ability itself ("AbilityCastRange"). */
  const links = (valueName: string, block: KV) => {
    for (const [k, linked] of Object.entries(block)) {
      if (isTalent(k) && typeof linked === "string") set(k, `bonus_${valueName}`, linked);
    }
  };
  const walk = (name: string, node: KV) => {
    const values = node.AbilityValues;
    if (isBlock(values)) {
      for (const [valueName, v] of Object.entries(values)) {
        if (isTalent(name)) {
          const own = valueOf(v);
          if (own !== undefined) set(name, valueName, own);
        }
        if (isBlock(v)) links(valueName, v);
      }
    }
    for (const [k, child] of Object.entries(node)) {
      if (!isBlock(child) || k === "AbilityValues") continue;
      links(k, child);
      walk(k, child);
    }
  };
  for (const file of files) walk("", file);
  return out;
}

/** A talent's description, lore and note lines, which are not its name. */
const EXTRA_TIP = /_(Description|Lore|Note\d*)$/;

/**
 * The talents' tooltip texts, by talent: "DOTA_Tooltip_ability_<talent>" lines only (not its description or note). The
 * file spells the prefix "ability" and "Ability" both.
 */
export function talentTooltips(file: KV): Map<string, string> {
  const out = new Map<string, string>();
  const prefix = "dota_tooltip_ability_";
  const walk = (node: KV) => {
    for (const [k, v] of Object.entries(node)) {
      if (isBlock(v)) walk(v);
      else if (k.toLowerCase().startsWith(prefix) && isTalent(k.slice(prefix.length)) && !EXTRA_TIP.test(k)) {
        out.set(k.slice(prefix.length), v);
      }
    }
  };
  walk(file);
  return out;
}

/** Ability ids by name from npc_ability_ids.txt ("special_bonus_hp_regen_4_5" "1956"). */
export function abilityIds(file: KV): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (node: KV) => {
    for (const [k, v] of Object.entries(node)) {
      if (isBlock(v)) walk(v);
      else if (/^\d+$/.test(v) && Number(v) > 0 && !out.has(k)) out.set(k, Number(v));
    }
  };
  walk(file);
  return out;
}

/**
 * "+20" as "20", "+-10" and "-0.5" as "10" and "0.5", "+25%" as "25": the text has the sign and the unit. Null when
 * it isn't one number (a value per level).
 */
function plain(value: string): string | null {
  const v = value.trim().replace(/^[+\-x=]+/, "").replace(/%$/, "");
  return /^\d*\.?\d+$/.test(v) ? v : null;
}

/**
 * A talent's name with its values filled in, like "+20 Curse of Avernus DPS". Each {s:name} takes the talent's value of
 * that name; a lone {s:value} with no own value takes the one value it changes elsewhere. Null when any can't be filled
 * or the name has markup.
 */
export function talentText(template: string, values: Map<string, string> | undefined): string | null {
  let failed = false;
  const text = template.replace(/\{s:([A-Za-z0-9_]+)\}/g, (_, name: string) => {
    let raw = values?.get(name);
    if (raw === undefined && name === "value" && values?.size === 1) raw = [...values.values()][0];
    const v = raw === undefined ? null : plain(raw);
    if (v === null) failed = true;
    return v ?? "";
  });
  if (failed) return null;
  const name = text.replace(/%%/g, "%").replace(/\s+/g, " ").trim();
  // A name is plain text: one with markup (no talent name has any) is left to OpenDota's.
  return name && !/[{}<>]/.test(name) ? name : null;
}

/** Talent names and ids from the game files, for the trees. */
export interface GameTalentTexts {
  names: Map<string, string>;
  ids: Map<string, number>;
}

/** Every talent's name that can be filled in from the tooltips and the ability files, and the game's ability ids. */
export function gameTalentTexts(tooltips: KV, abilityFiles: KV[], ids: KV): GameTalentTexts {
  const values = talentValues(abilityFiles);
  const names = new Map<string, string>();
  for (const [talent, template] of talentTooltips(tooltips)) {
    const name = talentText(template, values.get(talent));
    if (name) names.set(talent, name);
  }
  return { names, ids: abilityIds(ids) };
}
