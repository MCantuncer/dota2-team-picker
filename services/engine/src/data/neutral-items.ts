/**
 * The patch's neutral items, read from the game's own file so a patch's changes show on the next refresh. Since 7.38
 * neutral items are crafted from madstones: at each tier the player picks one of a few artifacts and one of a few
 * enchantments for their hero's attribute. OpenDota's item constants no longer say which tier an artifact is in, so:
 *
 * - Tiers, unlock minutes, craft costs, pools and enchantment levels: the game's neutral_items.txt (a mirror on GitHub).
 * - Names, pictures, spell text and bonuses: OpenDota's item constants, built from the game files on every patch.
 */
import { ENCHANT_GROUPS, type EnchantGroup, type ItemStat, type NeutralItem, type NeutralPool, type NeutralTier, type Snapshot } from "../engine/types";
import { toItemAbilities, type ItemConstantRow } from "./items";

/** The game file with the neutral tiers (Valve's file, mirrored by Dotabuff on every game update). */
export const NEUTRAL_FILE_URL = "https://raw.githubusercontent.com/dotabuff/d2vpkr/master/dota/scripts/npc/neutral_items.txt";
const NEUTRALS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A pool with fewer tiers or artifacts than this is a cut-short file, not a patch. */
const MIN_TIERS = 3;
const MIN_ARTIFACTS = 20;

/** A Valve KeyValues block: a key holds a string or a nested block. */
export type KeyValues = { [key: string]: string | KeyValues };

const isBlock = (v: unknown): v is KeyValues => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads a Valve KeyValues text ("key" "value" lines and "key" { ... } blocks), skipping // comments. */
export function parseKeyValues(text: string): KeyValues {
  const root: KeyValues = {};
  const stack: KeyValues[] = [root];
  let pending: string | null = null;
  const tokens = text.replace(/\/\/[^\n]*/g, "").match(/"[^"]*"|[{}]/g) ?? [];
  for (const token of tokens) {
    const top = stack.at(-1)!; // The root is never popped: a stray } is skipped below.
    if (token === "{") {
      const block: KeyValues = {};
      if (pending !== null) top[pending] = block;
      stack.push(block);
      pending = null;
    } else if (token === "}") {
      if (stack.length > 1) stack.pop();
      pending = null;
    } else if (pending === null) {
      pending = token.slice(1, -1);
    } else {
      top[pending] = token.slice(1, -1);
      pending = null;
    }
  }
  return root;
}

/** "15:00" as 15. */
const minuteOf = (time: unknown) => (typeof time === "string" && /^\d+:\d\d$/.test(time) ? Number(time.split(":")[0]) : NaN);
const itemKey = (name: string) => name.replace(/^item_/, "");

/**
 * The tiers of the neutral file, with item ids from OpenDota's constants. Items the constants don't have are left out
 * and named in `missing`. Throws when the file has no tiers.
 */
export function toNeutralTiers(file: KeyValues, rows: Record<string, ItemConstantRow>): { tiers: NeutralTier[]; missing: string[] } {
  const root = file.neutral_items;
  const tierBlocks = isBlock(root) && isBlock(root.neutral_tiers) ? root.neutral_tiers : null;
  if (!tierBlocks) throw new Error("The neutral file has no neutral_tiers block");
  const missing: string[] = [];
  const idOf = (name: string) => {
    const id = rows[itemKey(name)]?.id;
    if (typeof id === "number") return id;
    missing.push(itemKey(name));
    return undefined;
  };
  const tiers = Object.entries(tierBlocks).flatMap(([key, block]): NeutralTier[] => {
    if (!isBlock(block) || !/^\d+$/.test(key)) return [];
    const pools = isBlock(block.item_pools)
      ? Object.values(block.item_pools).flatMap((pool) =>
          isBlock(pool) && isBlock(pool.items) ? [Object.keys(pool.items).flatMap((name) => idOf(name) ?? [])] : [],
        )
      : [];
    const groups = isBlock(block.enhancements) ? block.enhancements : {};
    const enchants = Object.fromEntries(
      ENCHANT_GROUPS.map((group) => {
        const list = groups[group];
        const pairs = isBlock(list)
          ? Object.entries(list).flatMap(([name, level]): [number, number][] => {
              const id = idOf(name);
              return id !== undefined && /^\d+$/.test(String(level)) ? [[id, Number(level)]] : [];
            })
          : [];
        return [group, pairs];
      }),
    ) as Record<EnchantGroup, [number, number][]>;
    return [
      {
        tier: Number(key),
        minute: minuteOf(block.start_time),
        craftCost: Number(block.craft_cost),
        options: Number(block.trinket_options),
        pools: pools.filter((p) => p.length > 0),
        enchants,
      },
    ];
  });
  if (tiers.length === 0) throw new Error("The neutral file has no tiers");
  return { tiers: tiers.sort((a, b) => a.tier - b.tier), missing };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** "+ {value} Health" or "- {value}% Max Mana": the sign, the percent and the label. */
const BONUS = /^([+-]) ?\{value\}(%?) (.+)$/;

/**
 * The bonuses at one level from OpenDota's `attrib` lines ("110 / 170 / 230" is levels 1 to 3). Lines that cost keep
 * their minus ("- {value} Armor" with -4 is -4 Armor). Zero amounts mean the bonus starts at a later level.
 */
export function neutralStats(attrib: unknown, level = 1): ItemStat[] {
  if (!Array.isArray(attrib)) return [];
  return attrib.flatMap((row): ItemStat[] => {
    if (!isRecord(row) || typeof row.display !== "string") return [];
    const line = BONUS.exec(row.display.trim());
    if (!line || (typeof row.value !== "string" && typeof row.value !== "number")) return [];
    const levels = String(row.value).split("/").map((v) => v.trim());
    const amount = Number(levels[Math.min(level, levels.length) - 1]);
    if (!Number.isFinite(amount) || amount === 0) return [];
    const n = line[1] === "-" ? -Math.abs(amount) : amount;
    return [{ value: `${n > 0 ? "+" : ""}${n}${line[2]}`, label: line[3]!.trim() }]; // The pattern has three groups.
  });
}

/** The tooltip of every artifact and enchantment in the tiers, and the used-up forms of artifacts (`_broken`). */
export function toNeutralItems(tiers: NeutralTier[], rows: Record<string, ItemConstantRow>): Record<string, NeutralItem> {
  const byId = new Map<number, [string, ItemConstantRow]>();
  for (const [key, row] of Object.entries(rows)) if (typeof row.id === "number") byId.set(row.id, [key, row]);
  const items: Record<string, NeutralItem> = {};
  const add = (id: number, kind: NeutralItem["kind"], extra: Partial<NeutralItem>) => {
    const found = byId.get(id);
    if (!found || typeof found[1].dname !== "string") return;
    const [key, row] = found;
    const abilities = toItemAbilities(row.abilities);
    const cooldown = typeof row.cd === "number" && row.cd > 0 ? row.cd : undefined;
    items[id] = {
      key,
      name: row.dname as string, // Checked above.
      img: typeof row.img === "string" ? row.img.replace(/\?.*$/, "") : "",
      kind,
      ...extra,
      ...(abilities.length ? { abilities } : {}),
      ...(cooldown ? { cooldown } : {}),
    };
  };
  for (const t of tiers) {
    for (const id of t.pools.flat()) {
      const stats = neutralStats(byId.get(id)?.[1].attrib);
      add(id, "artifact", { tier: t.tier, ...(stats.length ? { stats } : {}) });
      const broken = rows[`${byId.get(id)?.[0]}_broken`]?.id;
      if (typeof broken === "number") add(broken, "artifact", { tier: t.tier, brokenOf: id });
    }
    for (const [id] of Object.values(t.enchants).flat()) {
      if (items[id]) continue;
      const attrib = byId.get(id)?.[1].attrib;
      const top = Math.max(1, ...tiers.flatMap((x) => Object.values(x.enchants).flat()).filter(([e]) => e === id).map(([, level]) => level));
      add(id, "enchantment", { levels: Array.from({ length: top }, (_, i) => neutralStats(attrib, i + 1)) });
    }
  }
  return items;
}

/** True when the neutral pool is missing or a day old. */
export function neutralsDue(snapshot: Pick<Snapshot, "neutrals">, now: Date): boolean {
  return !snapshot.neutrals || now.getTime() - Date.parse(snapshot.neutrals.at) >= NEUTRALS_MAX_AGE_MS;
}

/**
 * The neutral pool from the game file and OpenDota's item constants. Throws when the file looks cut short, so the
 * last pool stays. `missing` names pool items the constants don't have yet (a brand new item).
 */
export function buildNeutralPool(fileText: string, rows: Record<string, ItemConstantRow>, now: Date): { pool: NeutralPool; missing: string[] } {
  const { tiers, missing } = toNeutralTiers(parseKeyValues(fileText), rows);
  const artifacts = tiers.reduce((n, t) => n + t.pools.flat().length, 0);
  if (tiers.length < MIN_TIERS || artifacts < MIN_ARTIFACTS) throw new Error(`The neutral file has only ${tiers.length} tiers and ${artifacts} artifacts`);
  return { pool: { at: now.toISOString(), tiers, items: toNeutralItems(tiers, rows) }, missing };
}

/** Downloads the neutral file and OpenDota's item constants and builds the pool. */
export async function fetchNeutralPool(get: <T>(path: string) => Promise<T>, now: Date): Promise<{ pool: NeutralPool; missing: string[] }> {
  const res = await fetch(NEUTRAL_FILE_URL);
  if (!res.ok) throw new Error(`Neutral file: HTTP ${res.status}`);
  const text = await res.text();
  return buildNeutralPool(text, await get<Record<string, ItemConstantRow>>("/constants/items"), now);
}
