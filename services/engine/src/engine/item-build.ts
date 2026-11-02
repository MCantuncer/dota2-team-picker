import { chooseTimingSlice, finishedItems } from "./item-timing-slice";
import type { HeroInfo, ItemInfo, ItemPhases, Position, RankBracket, Snapshot } from "./types";

/**
 * Item builds for one hero against one enemy lineup: the build players really buy on the hero,
 * with counter items moved up or added when the enemy heroes call for them. Public data cannot say
 * which item wins against five given heroes (too few games), so the counter items come from a
 * hand-kept list of what each enemy brings and what answers it, and an item only goes in when
 * players already buy it on this hero.
 */

/** What an enemy hero brings that an item can answer. */
export type Threat =
  | "disable"
  | "magicBurst"
  | "heal"
  | "evasion"
  | "illusions"
  | "invisible"
  | "passives"
  | "physicalCarry"
  | "buffs";

/** Threats OpenDota roles cannot see, by hero display name. */
const THREAT_HEROES: Record<Exclude<Threat, "disable" | "magicBurst" | "physicalCarry">, string[]> = {
  heal: [
    "Lifestealer", "Necrophos", "Huskar", "Alchemist", "Omniknight", "Oracle", "Dazzle", "Warlock",
    "Chen", "Witch Doctor", "Morphling", "Abaddon", "Wraith King", "Undying", "Treant Protector", "Bristleback",
  ],
  evasion: ["Phantom Assassin", "Troll Warlord", "Windranger", "Brewmaster", "Arc Warden"],
  illusions: [
    // Heroes who fight with illusions all game. Spectre's Haunt and Monkey King's ult are short
    // bursts that Battle Fury or Mjollnir do not answer.
    "Phantom Lancer", "Naga Siren", "Terrorblade", "Chaos Knight", "Meepo", "Arc Warden",
  ],
  invisible: [
    "Riki", "Clinkz", "Bounty Hunter", "Nyx Assassin", "Weaver", "Mirana", "Invoker", "Templar Assassin",
    "Treant Protector", "Void Spirit",
  ],
  passives: [
    "Lifestealer", "Phantom Assassin", "Bristleback", "Spectre", "Slardar", "Huskar", "Faceless Void",
    "Troll Warlord", "Templar Assassin", "Tiny", "Sniper", "Ursa", "Medusa", "Necrophos", "Timbersaw",
  ],
  buffs: ["Omniknight", "Oracle", "Dazzle", "Ogre Magi", "Templar Assassin", "Abaddon", "Wraith King"],
};

/** Carries whose damage is mostly spells, so supports need no armour or Ghost Scepter against them. */
const MAGIC_CORES = new Set(["Storm Spirit", "Zeus", "Leshrac", "Tinker", "Lina", "Outworld Devourer", "Death Prophet"]);

/** The threats each enemy hero brings. Disables and magic burst come from OpenDota roles. */
export function threatsOf(hero: HeroInfo): Set<Threat> {
  const t = new Set<Threat>();
  if (hero.roles.includes("Disabler")) t.add("disable");
  if (hero.roles.includes("Nuker")) t.add("magicBurst");
  if (hero.roles.includes("Carry") && !MAGIC_CORES.has(hero.name)) t.add("physicalCarry");
  // Object.entries loses the key type; the keys are THREAT_HEROES keys, all Threats.
  for (const [threat, names] of Object.entries(THREAT_HEROES)) if (names.includes(hero.name)) t.add(threat as Threat);
  return t;
}

/** Who should think about an item: cores are pos 1-3, supports pos 4-5. */
type Buyer = "core" | "support" | "any";

interface CounterItem {
  key: string;
  answers: Threat[];
  /** Enemy heroes with one of `answers` needed before the item is worth suggesting. */
  minEnemies: number;
  buyer: Buyer;
}

/** Items that answer threats, best answer first within each threat. Matched by OpenDota item key. */
export const COUNTER_ITEMS: readonly CounterItem[] = [
  { key: "black_king_bar", answers: ["disable"], minEnemies: 3, buyer: "core" },
  { key: "monkey_king_bar", answers: ["evasion"], minEnemies: 1, buyer: "core" },
  { key: "silver_edge", answers: ["passives"], minEnemies: 1, buyer: "core" },
  { key: "spirit_vessel", answers: ["heal"], minEnemies: 2, buyer: "any" },
  { key: "skadi", answers: ["heal"], minEnemies: 2, buyer: "core" },
  { key: "nullifier", answers: ["buffs"], minEnemies: 1, buyer: "core" },
  { key: "mjollnir", answers: ["illusions"], minEnemies: 1, buyer: "core" },
  { key: "bfury", answers: ["illusions"], minEnemies: 1, buyer: "core" },
  { key: "crimson_guard", answers: ["illusions", "physicalCarry"], minEnemies: 2, buyer: "core" },
  { key: "gem", answers: ["invisible"], minEnemies: 1, buyer: "support" },
  { key: "lotus_orb", answers: ["disable"], minEnemies: 3, buyer: "any" },
  { key: "pipe", answers: ["magicBurst"], minEnemies: 3, buyer: "any" },
  { key: "ghost", answers: ["physicalCarry"], minEnemies: 2, buyer: "support" },
  { key: "glimmer_cape", answers: ["magicBurst"], minEnemies: 2, buyer: "support" },
  { key: "force_staff", answers: ["physicalCarry"], minEnemies: 1, buyer: "support" },
  { key: "heavens_halberd", answers: ["physicalCarry"], minEnemies: 1, buyer: "core" },
];

/** Bought for the lane or carried as charges, so never part of the core build. */
const CONSUMABLES = new Set([
  "tango", "flask", "clarity", "faerie_fire", "enchanted_mango", "ward_observer", "ward_sentry",
  "ward_dispenser", "tpscroll", "smoke_of_deceit", "dust", "blood_grenade", "tome_of_knowledge", "cheese",
]);

/** Items under this cost are lane items (Bracer, Wand), not part of the core build, except boots. */
const CORE_MIN_COST = 1500;
const BOOTS = new Set(["phase_boots", "power_treads", "arcane_boots", "tranquil_boots", "boots", "travel_boots", "guardian_greaves", "boots_of_bearing"]);

/** Whether an item can be part of a core build: boots, Aghanim's Shard, or any non-consumable from CORE_MIN_COST up. */
export function isCoreItem(item: ItemInfo | undefined): boolean {
  if (!item || CONSUMABLES.has(item.key)) return false;
  return BOOTS.has(item.key) || item.key === "aghanims_shard" || item.cost >= CORE_MIN_COST;
}

/** Enemy heroes named in one reason, those with the most matching threats first. */
const REASON_NAMES = 3;

/** An item counts as bought on a hero when it reaches this share of the hero's most bought item. */
const MIN_POPULARITY = 0.1;
const CORE_ITEMS = 6;
const START_ITEMS = 5;
const LANE_ITEMS = 2;
const SITUATIONAL_ITEMS = 3;
/** Rough minute each phase's items are bought by, for the order and the timings shown. */
const PHASE_MINUTE = { start: 0, early: 8, mid: 18, late: 32 } as const;

export interface BuildItem {
  itemId: number;
  name: string;
  img: string;
  /** About when it is bought, in minutes. */
  minute: number;
  /** After this minute a player is slower than most with this item. Not known yet for every item. */
  lateMinute?: number;
  /** Why it is in the build, naming the enemy heroes it answers. Empty for the usual build. */
  reason?: string;
  /** The enemy hero ids the item answers, most matching threats first. Set with `reason`. */
  against?: number[];
}

export interface ItemBuild {
  /**
   * Where the core items and minutes come from: STRATZ timings for the player's rank group ("rank")
   * or every rank ("all"), or rough minutes from OpenDota's game phases ("around").
   */
  timings: "rank" | "all" | "around";
  start: BuildItem[];
  /** Small items bought in lane before the core, like Bracer or Magic Wand. */
  lane: BuildItem[];
  core: BuildItem[];
  situational: BuildItem[];
}

/** Total times each item was bought after the horn, and the average minute it was bought. */
function boughtAfterHorn(phases: ItemPhases): Map<string, { count: number; minute: number }> {
  const out = new Map<string, { count: number; minute: number }>();
  for (const phase of ["early", "mid", "late"] as const) {
    for (const [id, n] of Object.entries(phases[phase])) {
      const prev = out.get(id) ?? { count: 0, minute: 0 };
      const count = prev.count + n;
      out.set(id, { count, minute: (prev.minute * prev.count + PHASE_MINUTE[phase] * n) / count });
    }
  }
  return out;
}

/**
 * The build for `heroId` at `position` against `enemies` (hero ids). The core comes from STRATZ item
 * timings for this position and rank when there are enough (see item-timing-slice.ts), else from
 * OpenDota's item popularity. Returns null when the snapshot has no item data for the hero.
 */
export function itemBuild(
  data: Snapshot,
  heroId: number,
  position: Position,
  enemies: number[],
  rankBracket?: RankBracket,
): ItemBuild | null {
  const phases = data.itemBuilds?.[heroId];
  const items = data.items;
  if (!phases || !items) return null;
  const idOf = (key: string) => Object.keys(items).find((id) => items[id]?.key === key);
  const toItem = (id: string, minute: number, reason?: string): BuildItem => {
    const item = items[id] as ItemInfo; // Builds only hold ids found in `items` (see data/items.ts).
    return { itemId: Number(id), name: item.name, img: item.img, minute: Math.round(minute), ...(reason ? { reason } : {}) };
  };

  const start = Object.entries(phases.start)
    // A support's start list holds both the ward pack and single wards; keep the pack.
    .filter(([id]) => items[id]?.key !== "ward_sentry" || !phases.start[idOf("ward_dispenser") ?? ""])
    .sort((a, b) => b[1] - a[1])
    .slice(0, START_ITEMS)
    .map(([id]) => toItem(id, 0));

  const bought = boughtAfterHorn(phases);
  const top = Math.max(0, ...[...bought.values()].map((b) => b.count));
  const popular = (id: string) => (bought.get(id)?.count ?? 0) >= top * MIN_POPULARITY;
  // Components of another bought item are steps on the way, not items of the build.
  const parts = new Set([...bought.keys()].flatMap((id) => items[id]?.components ?? []).map(String));
  const candidates = [...bought.entries()]
    .filter(([id, b]) => !parts.has(id) && !CONSUMABLES.has(items[id]?.key ?? "") && b.count >= top * MIN_POPULARITY)
    .sort((a, b) => b[1].count - a[1].count);
  const isBoots = (id: string) => BOOTS.has(items[id]?.key ?? "");
  const isBig = (id: string) => isCoreItem(items[id]);
  // One pair of boots: the most bought.
  const boots = candidates.find(([id]) => isBoots(id))?.[0];
  const chosen = chooseTimingSlice(data, heroId, position, rankBracket);
  const timed = new Map(chosen?.slice.items.map(([id, minute, lateMinute]) => [String(id), { minute, lateMinute }]));
  const core = chosen
    ? [
        // STRATZ keeps boots out of its item timings, so they still come from OpenDota.
        ...(boots ? [toItem(boots, bought.get(boots)?.minute ?? PHASE_MINUTE.early)] : []),
        ...finishedItems(chosen.slice, items)
          .filter(([id]) => isBig(String(id)) && !isBoots(String(id)))
          .slice(0, CORE_ITEMS - (boots ? 1 : 0))
          .map(([id, minute, lateMinute]) => ({ ...toItem(String(id), minute), lateMinute })),
      ].sort((a, b) => a.minute - b.minute)
    : candidates
        .filter(([id]) => isBig(id) && (!isBoots(id) || id === boots))
        .slice(0, CORE_ITEMS)
        .map(([id, b]) => toItem(id, b.minute))
        .sort((a, b) => a.minute - b.minute);
  oneAfterAnother(core);
  const lane = candidates
    .filter(([id]) => !isBig(id))
    .slice(0, LANE_ITEMS)
    .map(([id, b]) => toItem(id, b.minute));

  const isCore = position <= 3;
  const enemyHeroes = enemies.flatMap((id) => (data.heroes[id] ? [data.heroes[id]] : []));
  const situational: BuildItem[] = [];
  const idByKey = new Map(Object.entries(items).map(([id, item]) => [item.key, id]));
  for (const rule of COUNTER_ITEMS) {
    if (rule.buyer !== "any" && (rule.buyer === "core") !== isCore) continue;
    const id = idByKey.get(rule.key);
    if (!id || !popular(id)) continue;
    const matches = (h: HeroInfo) => rule.answers.filter((t) => threatsOf(h).has(t)).length;
    const answered = enemyHeroes.filter((h) => matches(h) > 0).sort((a, b) => matches(b) - matches(a));
    if (answered.length < rule.minEnemies) continue;
    const named = answered.slice(0, REASON_NAMES);
    const reason = `Against ${listNames(named.map((h) => h.name))}`;
    const against = named.map((h) => h.id);
    const inCore = core.findIndex((c) => c.itemId === Number(id));
    if (inCore >= 0) {
      // Already in the build: it keeps the minute players really buy it at. Moving it earlier would
      // promise a minute nobody reaches (Monkey King Bar at 14 on Juggernaut, when players buy it at 34).
      const item = core[inCore]!; // inCore is a valid index.
      core[inCore] = { ...item, reason: inCore > 1 ? `${reason}: don't skip it` : reason, against };
    } else if (situational.length < SITUATIONAL_ITEMS && !situational.some((s) => s.itemId === Number(id))) {
      const timing = timed.get(id);
      situational.push({
        ...(timing
          ? { ...toItem(id, timing.minute, reason), lateMinute: timing.lateMinute }
          : toItem(id, bought.get(id)?.minute ?? PHASE_MINUTE.mid, reason)),
        against,
      });
    }
  }
  return { timings: chosen?.source ?? "around", start, lane, core, situational };
}

/**
 * Items are bought one after another, so no two share a minute: a later item with the same rounded
 * minute as the one before it moves one minute on. `core` is sorted by minute.
 */
function oneAfterAnother(core: BuildItem[]): void {
  for (let i = 1; i < core.length; i++) {
    const before = core[i - 1]!.minute; // i - 1 is a valid index.
    const item = core[i]!; // i is a valid index.
    if (item.minute > before) continue;
    const moved: BuildItem = { ...item, minute: before + 1 };
    // A slower-than-most minute the item no longer comes before means nothing.
    if (moved.lateMinute !== undefined && moved.lateMinute <= moved.minute) delete moved.lateMinute;
    core[i] = moved;
  }
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
