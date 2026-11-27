/**
 * The shop items read from the game's own files, so a patch's item changes (letter patches too) show on the next
 * refresh. OpenDota's item list is built from the same files but only when OpenDota updates it: 7.42a cut Eye of
 * Skadi to +32 All Attributes and OpenDota still listed +35 days later.
 *
 * - Gold and parts: items.txt, the item's "ItemCost" and the recipe block whose "ItemResult" is the item.
 * - Bonuses: the item's AbilityValues that abilities_english.txt shows as a bonus line ("+$all" is "+32 All
 *   Attributes", "%+$spell_resist" is "+20% Magic Resistance").
 * - Spells: the item's "Description" there, cut at each "<h1>Active: Glimmer</h1>" heading, with the values filled in.
 * - Ids: npc_ability_ids.txt, so an item OpenDota doesn't list yet still gets its card.
 *
 * Each refresh lays these over the item list from OpenDota (see applyGameItems): the names and art stay OpenDota's,
 * every number comes from the game.
 */
import type { ItemAbility, ItemInfo, ItemStat } from "../engine/types";
import { toSpellText } from "./items";
import { abilityIds, ABILITY_IDS_FILE, GAME_FILES_URL, parseKV, TOOLTIPS_FILE, type KV } from "./talent-texts";
import { ITEMS_FILE } from "./removed-items";

/** The game's picture of every shop item on the Steam CDN, by its internal name. */
const ITEM_IMG = "/apps/dota2/images/dota_react/items/";

/**
 * Fewer items read than this means a file was cut short or changed shape: 7.42a's files give about 250 shop items.
 */
export const MIN_GAME_ITEMS = 150;

const isBlock = (v: string | KV | undefined): v is KV => typeof v === "object";

/** A value as text, or the "value" inside a value block. */
function valueOf(v: string | KV | undefined): string | undefined {
  if (typeof v === "string") return v;
  return isBlock(v) && typeof v.value === "string" ? v.value : undefined;
}

/** The value for an item's level: "27 24 21 18 15" at Dagon level 3 is 21. Null when it isn't a number. */
export function atLevel(raw: string | undefined, level: number): number | null {
  if (raw === undefined) return null;
  const levels = raw.trim().split(/\s+/);
  const v = levels[Math.min(Math.max(level, 1), levels.length) - 1]?.replace(/^[+=x]/, "").replace(/%$/, "");
  if (v === undefined || !/^-?\d*\.?\d+$/.test(v)) return null;
  return Number(v);
}

/** The tooltip lines by lower-cased key ("dota_tooltip_ability_item_skadi_bonus_all_stats"). */
export function tooltipLines(file: KV): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (node: KV) => {
    for (const [k, v] of Object.entries(node)) {
      if (isBlock(v)) walk(v);
      else out.set(k.toLowerCase(), v);
    }
  };
  walk(file);
  return out;
}

/**
 * Text with its markup taken out: "<br>" is a new line, any other tag goes and keeps what it wraps. Done by walking
 * the text rather than a pattern, so a tag cut short drops the rest of the line instead of leaving half a tag.
 */
export function plainText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] !== "<") {
      out += text[i++];
      continue;
    }
    const end = text.indexOf(">", i);
    if (end < 0) break;
    if (/^<br\s*\/?>$/i.test(text.slice(i, end + 1))) out += "\n";
    i = end + 1;
  }
  return out.replace(/\\n/g, "\n");
}

/** Values a spell's text names that are the ability's own fields, not its AbilityValues: "%abilitycooldown%". */
const ABILITY_FIELDS: Record<string, string> = {
  abilitycastpoint: "AbilityCastPoint",
  abilitycastrange: "AbilityCastRange",
  abilitychanneltime: "AbilityChannelTime",
  abilitychargerestoretime: "AbilityChargeRestoreTime",
  abilitycharges: "AbilityCharges",
  abilitycooldown: "AbilityCooldown",
  abilityduration: "AbilityDuration",
  abilityhealthcost: "AbilityHealthCost",
  abilitymanacost: "AbilityManaCost",
};

/** A number as the game shows it: "3.0" is 3, "0.50" is 0.5. */
const shown = (n: number) => String(Number(n.toFixed(2)));

/**
 * A spell text with its "%name%" values filled in for the item's level and "%%" as "%". Null when a name has no value,
 * so a half-filled text never shows ("Consume %abilityhealthcost% health").
 */
export function fillText(template: string, values: Map<string, string>, block: KV, level: number): string | null {
  let failed = false;
  const text = template.replace(/%([A-Za-z0-9_]*)%/g, (_, name: string) => {
    if (name === "") return "%";
    const field = ABILITY_FIELDS[name.toLowerCase()];
    const raw = field ? valueOf(block[field]) : (values.get(name) ?? values.get(name.toLowerCase()));
    const n = atLevel(raw, level);
    if (n === null) failed = true;
    return n === null ? "" : shown(n);
  });
  return failed ? null : text;
}

/** "Active", "Passive", "Use" and "Toggle" headings; others (an "Upgrade" line) aren't the item's own spell. */
const HEADING = /^(Active|Passive|Use|Toggle):\s*(.+)$/i;

/**
 * The item's spells from its "Description": each "<h1>Active: Glimmer</h1>" starts one, its text runs to the next
 * heading. Null when the text can't be filled in, so OpenDota's stays.
 */
export function gameSpells(description: string | undefined, values: Map<string, string>, block: KV, level: number): ItemAbility[] | null {
  if (description === undefined) return [];
  const filled = fillText(description, values, block, level);
  if (filled === null) return null;
  const parts = filled.split(/<h1>/i).slice(1);
  return parts.flatMap((part): ItemAbility[] => {
    const close = part.search(/<\/h1>/i);
    if (close < 0) return [];
    const heading = HEADING.exec(plainText(part.slice(0, close)).trim());
    if (!heading) return [];
    const kind = heading[1]!.toLowerCase() === "passive" ? "passive" : "active"; // The pattern has two groups.
    return [{ kind, name: heading[2]!.trim(), ...toSpellText(plainText(part.slice(close + 5))) }];
  });
}

/**
 * A bonus line: "+$all" and "%+$spell_resist" name a shared label, "+Move Speed (Melee Heroes)" and "%+Slow Resistance"
 * spell it out. The "%" in front makes the amount a share.
 */
const BONUS_LINE = /^(%?)\+(?:\$([a-z_]+)|([A-Za-z][A-Za-z0-9 ()/'-]*))$/;

/** The item's bonus lines in the file's order, with this level's amount; zero amounts are left out. */
export function gameStats(name: string, values: Map<string, string>, tips: Map<string, string>, level: number): ItemStat[] | null {
  const out: ItemStat[] = [];
  for (const [key, raw] of values) {
    const line = BONUS_LINE.exec(tips.get(`dota_tooltip_ability_item_${name}_${key}`.toLowerCase())?.trim() ?? "");
    if (!line) continue;
    const n = atLevel(raw, level);
    if (n === 0) continue;
    const label = line[2] ? tips.get(`dota_ability_variable_${line[2]}`) : line[3];
    if (!label || n === null) return null;
    out.push({ value: `${n > 0 ? "+" : ""}${shown(n)}${line[1]}`, label: plainText(label).replace(/\s+/g, " ").trim() });
  }
  return out;
}

/** One shop item as the game files have it, by its internal name without "item_". */
export interface GameItem {
  id: number;
  key: string;
  /** The game's name for it, for an item OpenDota doesn't list yet. */
  name?: string;
  cost: number;
  /** Internal names of the parts, recipe left out; empty for a basic item. Undefined when no recipe makes it. */
  components?: string[];
  /** Null when a bonus line couldn't be read: OpenDota's stay. */
  stats: ItemStat[] | null;
  /** Null when the spell text couldn't be filled in: OpenDota's stay. */
  abilities: ItemAbility[] | null;
  cooldown?: number;
  manaCost?: number;
  /** False for items the shop doesn't sell (neutral items, rune bottles, event items). */
  purchasable: boolean;
}

/**
 * Every item the item file sells or builds, from its three files. Recipes and items marked "IsObsolete" are left out.
 */
export function gameItems(itemsFile: KV, idsFile: KV, tooltipsFile: KV): Map<string, GameItem> {
  const ids = abilityIds(idsFile);
  const tips = tooltipLines(tooltipsFile);
  const blocks = new Map<string, KV>();
  const walk = (node: KV) => {
    for (const [k, v] of Object.entries(node)) {
      if (!isBlock(v)) continue;
      if (k.startsWith("item_")) blocks.set(k.slice(5), v);
      else walk(v);
    }
  };
  walk(itemsFile);

  // The recipe that makes each item: its first list of parts, the recipe scroll's own name taken out.
  const recipeOf = new Map<string, { parts: string[]; cost: number }>();
  for (const [name, block] of blocks) {
    if (!name.startsWith("recipe_") || typeof block.ItemResult !== "string") continue;
    const result = block.ItemResult.replace(/^item_/, "");
    const lists = isBlock(block.ItemRequirements) ? Object.values(block.ItemRequirements).filter((v) => typeof v === "string") : [];
    if (!lists.length || recipeOf.has(result)) continue;
    const parts = (lists[0] as string)
      .split(";")
      .map((p) => p.trim().replace(/^item_/, "").replace(/\*$/, ""))
      .filter((p) => p && !p.startsWith("recipe_"));
    recipeOf.set(result, { parts, cost: Number(block.ItemCost ?? 0) || 0 });
  }

  const out = new Map<string, GameItem>();
  for (const [name, block] of blocks) {
    if (name.startsWith("recipe_") || block.IsObsolete === "1") continue;
    const id = ids.get(`item_${name}`);
    if (id === undefined) continue;
    const level = Number(block.ItemBaseLevel ?? /_(\d+)$/.exec(name)?.[1] ?? 1) || 1;
    const values = new Map<string, string>();
    if (isBlock(block.AbilityValues)) {
      for (const [k, v] of Object.entries(block.AbilityValues)) {
        const raw = valueOf(v);
        if (raw !== undefined) values.set(k, raw);
      }
    }
    const recipe = recipeOf.get(name);
    const own = Number(block.ItemCost ?? 0) || 0;
    const partsCost = recipe ? recipe.parts.reduce((sum, p) => sum + (Number(blocks.get(p)?.ItemCost ?? 0) || 0), 0) + recipe.cost : 0;
    const cooldown = atLevel(valueOf(block.AbilityCooldown), level);
    const manaCost = atLevel(valueOf(block.AbilityManaCost), level);
    const gameName = tips.get(`dota_tooltip_ability_item_${name}`);
    out.set(name, {
      id,
      key: name,
      ...(gameName ? { name: plainText(gameName).replace(/\s+/g, " ").trim() } : {}),
      cost: own > 0 ? own : partsCost,
      ...(recipe ? { components: recipe.parts } : {}),
      stats: gameStats(name, values, tips, level),
      abilities: gameSpells(tips.get(`dota_tooltip_ability_item_${name}_description`), values, block, level),
      ...(cooldown && cooldown > 0 ? { cooldown } : {}),
      ...(manaCost && manaCost > 0 ? { manaCost } : {}),
      purchasable: block.ItemPurchasable !== "0" && block.ItemIsNeutralActiveDrop !== "1" && block.ItemIsNeutralPassiveDrop !== "1",
    });
  }
  return out;
}

/** What laying the game's items over the list changed, for the log. */
export interface GameItemsApplied {
  /** Items whose gold, parts, bonuses or spells differ from OpenDota's, by name, with what changed. */
  changed: { name: string; fields: string[] }[];
  /** Items the game sells that OpenDota's list doesn't have yet. */
  added: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Lays the game's numbers over the item list in place: gold, parts, bonuses, spells, cooldown and mana. A bonus list
 * or spell text the files couldn't fill keeps OpenDota's. An item the shop sells that the list lacks is added with
 * the game's name and the usual picture path. Items with no gold in the game (Medallion's parts only) are left.
 */
export function applyGameItems(items: Record<string, ItemInfo>, game: Map<string, GameItem>): GameItemsApplied {
  const idOf = new Map([...game.values()].map((g) => [g.key, g.id]));
  const changed: GameItemsApplied["changed"] = [];
  const added: string[] = [];
  for (const g of game.values()) {
    if (g.cost <= 0) continue;
    const components = g.components?.map((p) => idOf.get(p));
    const parts = components && components.every((id) => id !== undefined) ? (components as number[]) : undefined;
    const before = items[g.id];
    if (!before) {
      // A basic item has no recipe; a built one needs every part known.
      if (!g.purchasable || !g.name || (g.components && !parts)) continue;
      items[g.id] = { key: g.key, name: g.name, cost: g.cost, img: `${ITEM_IMG}${g.key}.png`, components: parts ?? [], ...spellsOf(g) };
      added.push(g.name);
      continue;
    }
    const next: ItemInfo = { ...before, cost: g.cost };
    // A level item no recipe makes in the file (Dagon 2 to 5) keeps the level below it as its part.
    if (parts && (parts.length || !before.components.length)) next.components = parts;
    if (g.stats !== null) {
      if (g.stats.length) next.stats = g.stats;
      else delete next.stats;
    }
    if (g.abilities !== null) {
      if (g.abilities.length) next.abilities = g.abilities;
      else delete next.abilities;
      const used = g.abilities.some((a) => a.kind === "active");
      if (used && g.cooldown) next.cooldown = g.cooldown;
      else delete next.cooldown;
      if (used && g.manaCost) next.manaCost = g.manaCost;
      else delete next.manaCost;
    }
    const fields = (["cost", "components", "stats", "abilities", "cooldown", "manaCost"] as const).filter((f) => !same(before[f], next[f]));
    if (fields.length) changed.push({ name: before.name, fields });
    items[g.id] = next;
  }
  return { changed, added };
}

/** An added item's bonuses and spells, the ones the files could fill. */
function spellsOf(g: GameItem): Partial<ItemInfo> {
  const used = g.abilities?.some((a) => a.kind === "active") ?? false;
  return {
    ...(g.stats?.length ? { stats: g.stats } : {}),
    ...(g.abilities?.length ? { abilities: g.abilities } : {}),
    ...(used && g.cooldown ? { cooldown: g.cooldown } : {}),
    ...(used && g.manaCost ? { manaCost: g.manaCost } : {}),
  };
}

/** Downloads the three files and reads the items. Throws when the list looks cut short. */
export async function fetchGameItems(getText: (url: string) => Promise<string>): Promise<Map<string, GameItem>> {
  const [items, ids, tips] = await Promise.all([ITEMS_FILE, ABILITY_IDS_FILE, TOOLTIPS_FILE].map((f) => getText(`${GAME_FILES_URL}${f}`)));
  const out = gameItems(parseKV(items!), parseKV(ids!), parseKV(tips!));
  const sold = [...out.values()].filter((g) => g.purchasable && g.cost > 0).length;
  if (sold < MIN_GAME_ITEMS) throw new Error(`only ${sold} shop items found`);
  return out;
}
