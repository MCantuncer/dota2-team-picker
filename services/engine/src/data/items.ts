/**
 * Shop items and how often each hero buys them, from the free OpenDota API, for the item
 * builds in the game plan. One request for the item list, then one per hero for its item
 * popularity, so they are refreshed once a day rather than on every run.
 */
import type { ItemAbility, ItemInfo, ItemPhases, ItemStat, Snapshot } from "../engine/types";

const ITEMS_MAX_AGE_DAYS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Items kept per hero and phase; the rest are rare buys that never make a build. */
const TOP_PER_PHASE = 15;
const PHASES = ["start", "early", "mid", "late"] as const;

/** One entry of OpenDota's /constants/items, keyed by internal name. */
export interface ItemConstantRow {
  id?: unknown;
  dname?: unknown;
  cost?: unknown;
  img?: unknown;
  components?: unknown;
  attrib?: unknown;
  abilities?: unknown;
  cd?: unknown;
  mc?: unknown;
}

/** OpenDota's /heroes/{id}/itemPopularity: times bought per item id in each phase. */
export type ItemPopularityRow = Partial<Record<`${(typeof PHASES)[number]}_game_items`, Record<string, unknown>>>;

export function itemsDue(snapshot: Snapshot, now: Date): boolean {
  if (!snapshot.itemsAt || !snapshot.items || !snapshot.itemBuilds) return true;
  return now.getTime() - Date.parse(snapshot.itemsAt) >= ITEMS_MAX_AGE_DAYS * DAY_MS;
}

/**
 * The level below an upgraded item, like `dagon_2` for `dagon_3` and `dagon` for `dagon_2`, when the list has it.
 * OpenDota lists no parts for Dagon's levels, so without this each level looked like its own finished item and
 * a build showed Dagon four times (Keeper of the Light mid: Dagon at 13, 16, 19 and 20).
 */
function lowerLevel(key: string, cost: number, rows: Record<string, ItemConstantRow>): string | undefined {
  const match = /^(.+)_(\d+)$/.exec(key);
  if (!match) return undefined;
  const [, base, level] = match;
  if (base === undefined) return undefined;
  const lower = Number(level) === 2 ? base : `${base}_${Number(level) - 1}`;
  const below = rows[lower]?.cost;
  // A real upgrade costs more than the level below it.
  return typeof below === "number" && below < cost ? lower : undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A shop line that adds to the hero: "+ {value} Health", "+ {value}% Evasion". Lines like "COOLDOWN: {value}" are not bonuses. */
const BONUS = /^\+ ?\{value\}(%?) (.+)$/;

/** "Damage (MELEE)" as "Damage (Melee)": the site writes no word in capitals. */
const titleWords = (label: string) => label.replace(/\b([A-Z])([A-Z]{2,})\b/g, (_, first: string, rest: string) => first + rest.toLowerCase());

/**
 * The bonuses an item adds to its hero, from the shop lines in OpenDota's `attrib`. An item with levels lists every
 * level's amount ("200 / 210 / 220"), so the amount of this level is kept (`dagon_2` is level 2). Zero amounts are
 * left out: OpenDota lists some bonuses an item no longer gives (Skadi's Health) as 0.
 */
export function toItemStats(key: string, attrib: unknown): ItemStat[] {
  if (!Array.isArray(attrib)) return [];
  const level = Number(/_(\d+)$/.exec(key)?.[1] ?? 1);
  return attrib.flatMap((row) => {
    if (!isRecord(row) || typeof row.display !== "string") return [];
    const line = BONUS.exec(row.display.trim());
    if (!line || (typeof row.value !== "string" && typeof row.value !== "number")) return [];
    const levels = String(row.value).split("/").map((v) => v.trim());
    const amount = levels[Math.min(level, levels.length) - 1];
    if (amount === undefined || amount === "" || !Number.isFinite(Number(amount)) || Number(amount) === 0) return [];
    const n = Number(amount);
    return [{ value: `${n > 0 ? "+" : ""}${n}${line[1]}`, label: titleWords(line[2]!.trim()) }]; // The pattern has two groups.
  });
}

/** A tooltip line that is a number, like "Duration: 9s" or "Dispel Type: Basic Dispel". */
const FACT_LINE = /^([A-Z][A-Za-z' -]{1,30}):\s*(.{1,40})$/;

/** A spell's tooltip as its text and its number lines; the text's paragraphs are joined into one. */
export function toSpellText(description: unknown): Pick<ItemAbility, "text" | "facts"> {
  if (typeof description !== "string") return {};
  const text: string[] = [];
  const facts: { label: string; value: string }[] = [];
  for (const raw of description.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const fact = FACT_LINE.exec(line);
    if (fact) facts.push({ label: titleWords(fact[1]!.trim()), value: fact[2]!.trim() }); // The pattern has two groups.
    else text.push(line);
  }
  return { ...(text.length ? { text: text.join(" ") } : {}), ...(facts.length ? { facts } : {}) };
}

/** The item's own spells with their tooltips. OpenDota's "upgrade" lines are what Aghanim's adds to a hero, not the item's spell. */
export function toItemAbilities(abilities: unknown): ItemAbility[] {
  if (!Array.isArray(abilities)) return [];
  return abilities.flatMap((a): ItemAbility[] => {
    if (!isRecord(a) || typeof a.title !== "string" || !a.title.trim()) return [];
    const kind = a.type === "passive" ? "passive" : a.type === "active" || a.type === "toggle" || a.type === "use" ? "active" : undefined;
    return kind ? [{ kind, name: a.title.trim(), ...toSpellText(a.description) }] : [];
  });
}

/** A positive number of seconds or mana from the constants, which write `false` for none. */
const positive = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** Turns OpenDota's item constants into items by id, dropping recipes and free items. */
export function toItems(rows: Record<string, ItemConstantRow>): Record<string, ItemInfo> {
  const idByKey = new Map<string, number>();
  for (const [key, row] of Object.entries(rows)) if (typeof row.id === "number") idByKey.set(key, row.id);
  const items: Record<string, ItemInfo> = {};
  for (const [key, row] of Object.entries(rows)) {
    if (key.startsWith("recipe_") || typeof row.id !== "number" || typeof row.dname !== "string") continue;
    if (typeof row.cost !== "number" || row.cost <= 0) continue;
    const listed = Array.isArray(row.components) ? row.components : [];
    const lower = lowerLevel(key, row.cost, rows);
    const components = listed.length || lower === undefined ? listed : [lower];
    const stats = toItemStats(key, row.attrib);
    const abilities = toItemAbilities(row.abilities);
    // A cooldown or mana cost belongs to a spell the player uses; a passive's numbers are not shown as the item's.
    const used = abilities.some((a) => a.kind === "active");
    const cooldown = used ? positive(row.cd) : undefined;
    const manaCost = used ? positive(row.mc) : undefined;
    items[row.id] = {
      key,
      name: row.dname,
      cost: row.cost,
      // Drop the cache-busting query, the path is enough.
      img: typeof row.img === "string" ? row.img.replace(/\?.*$/, "") : "",
      components: components.flatMap((c) => {
        const id = typeof c === "string" ? idByKey.get(c) : undefined;
        return id === undefined ? [] : [id];
      }),
      ...(stats.length ? { stats } : {}),
      ...(abilities.length ? { abilities } : {}),
      ...(cooldown ? { cooldown } : {}),
      ...(manaCost ? { manaCost } : {}),
    };
  }
  return items;
}

/** Keeps the most bought known items of each phase. */
export function toItemPhases(row: ItemPopularityRow, items: Record<string, ItemInfo>): ItemPhases {
  const top = (phase: (typeof PHASES)[number]) =>
    Object.fromEntries(
      Object.entries(row[`${phase}_game_items`] ?? {})
        .flatMap(([id, n]) => (items[id] && typeof n === "number" && n > 0 ? [[id, n] as const] : []))
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_PER_PHASE),
    );
  return { start: top("start"), early: top("early"), mid: top("mid"), late: top("late") };
}

/** Downloads the item list and every hero's item popularity into the snapshot. */
export async function fetchItems(snapshot: Snapshot, get: <T>(path: string) => Promise<T>, now: Date) {
  const items = toItems(await get<Record<string, ItemConstantRow>>("/constants/items"));
  const builds: Record<string, ItemPhases> = {};
  for (const id of Object.keys(snapshot.heroes)) {
    builds[id] = toItemPhases(await get<ItemPopularityRow>(`/heroes/${id}/itemPopularity`), items);
  }
  snapshot.items = items;
  snapshot.itemBuilds = builds;
  snapshot.itemsAt = now.toISOString();
}
