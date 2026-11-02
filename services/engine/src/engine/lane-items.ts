/**
 * Start and lane items changed for the lane this draft gives a player. STRATZ has no purchases by
 * lane opponent, so these are hand rules (checked by a strong player, see the PR):
 * - A hard lane starts with a Healing Salve and one more Tango, paid for by optional stat items.
 * - Spell spammers in the lane: Magic Wand early, since every spell they cast charges it.
 * - Magic burst in the lane (two burst heroes, or one in a hard lane): Infused Raindrops.
 * Every changed item is marked `draft` with the enemy heroes it answers.
 */
import { listNames, type BuildItem, type ItemBuild } from "./item-build";
import type { HeroInfo, ItemInfo } from "./types";

/** Heroes whose lane is a stream of cheap spells, so a Magic Wand fills fast. */
export const SPELL_SPAMMERS = new Set([
  "Bristleback", "Batrider", "Skywrath Mage", "Zeus", "Huskar", "Venomancer", "Death Prophet", "Leshrac",
  "Storm Spirit", "Queen of Pain", "Jakiro", "Necrophos", "Timbersaw", "Earth Spirit", "Witch Doctor",
  "Sand King", "Puck", "Dazzle", "Winter Wyvern", "Ancient Apparition",
]);

/** Heroes who kill in lane with a few big magic spells, which Infused Raindrops soften. */
export const MAGIC_BURST = new Set([
  "Lion", "Lina", "Lich", "Zeus", "Skywrath Mage", "Tinker", "Pugna", "Queen of Pain", "Nyx Assassin",
  "Shadow Fiend", "Leshrac", "Earthshaker",
]);

/** Optional start items given up first to pay for sustain in a hard lane, in that order. */
const GIVE_UP_FIRST = ["faerie_fire", "circlet", "slippers", "mantle", "gauntlets", "enchanted_mango"];
/** Minute an early Magic Wand or Infused Raindrops is bought by in a lane that calls for it. */
const EARLY_MINUTE = { magic_wand: 3, infused_raindrop: 4 } as const;
/** Burst heroes in a lane that is not hard before Raindrops are worth it. */
const BURST_HEROES_FOR_RAINDROPS = 2;

export interface LaneFacts {
  verdict: "win" | "even" | "hard";
  /** The enemy heroes in this player's lane. */
  enemies: HeroInfo[];
}

/** The item with `count` copies; one copy carries no count. */
function withCount(item: BuildItem, count: number): BuildItem {
  const { count: _, ...rest } = item;
  return count > 1 ? { ...rest, count } : rest;
}

export function laneAdjusted(build: ItemBuild, lane: LaneFacts, items: Record<string, ItemInfo>): ItemBuild {
  const idOf = (key: string) => Object.keys(items).find((id) => items[id]?.key === key);
  const make = (key: string, minute: number): BuildItem | null => {
    const id = idOf(key);
    const item = id ? items[id] : undefined;
    return id && item ? { itemId: Number(id), name: item.name, img: item.img, minute, phase: minute === 0 ? "start" : "lane" } : null;
  };
  const keyOf = (i: BuildItem) => items[i.itemId]?.key;
  const mark = (item: BuildItem, reason: string, heroes: HeroInfo[]): BuildItem => ({
    ...item,
    draft: true,
    reason,
    against: heroes.map((h) => h.id),
  });
  let start = [...build.start];
  let laneItems = [...build.lane];

  if (lane.verdict === "hard" && lane.enemies.length) {
    const reason = `Hard lane against ${listNames(lane.enemies.map((h) => h.name))}: more sustain`;
    const salve = make("flask", 0);
    const tango = start.find((i) => keyOf(i) === "tango");
    const added = salve && !start.some((i) => keyOf(i) === "flask") ? salve : null;
    let cost = (added ? items[added.itemId]!.cost : 0) + (items[idOf("tango") ?? ""]?.cost ?? 0);
    // Pay for it with optional stat items, one copy at a time, until it is paid.
    for (const key of GIVE_UP_FIRST) {
      while (cost > 0) {
        const i = start.findIndex((s) => keyOf(s) === key);
        if (i < 0) break;
        const s = start[i]!; // i is a valid index.
        cost -= items[s.itemId]!.cost;
        start = (s.count ?? 1) > 1 ? start.map((x, j) => (j === i ? withCount(x, (s.count ?? 1) - 1) : x)) : start.filter((_, j) => j !== i);
      }
    }
    start = start.map((s) => (s === tango ? mark(withCount(s, (s.count ?? 1) + 1), reason, lane.enemies) : s));
    if (!tango) {
      const t = make("tango", 0);
      if (t) start.push(mark(t, reason, lane.enemies));
    }
    if (added) start.push(mark(added, reason, lane.enemies));
  }

  const spammers = lane.enemies.filter((h) => SPELL_SPAMMERS.has(h.name));
  if (spammers.length) {
    const reason = `Against ${listNames(spammers.map((h) => h.name))}'s spells: get it early`;
    const i = laneItems.findIndex((s) => keyOf(s) === "magic_wand");
    const wand = i >= 0 ? laneItems[i]! : make("magic_wand", EARLY_MINUTE.magic_wand);
    // Only a change counts: a Wand players already buy by then stays as it is.
    if (wand && (i < 0 || wand.minute > EARLY_MINUTE.magic_wand)) {
      const early = mark({ ...wand, minute: EARLY_MINUTE.magic_wand }, reason, spammers);
      laneItems = i >= 0 ? laneItems.map((s, j) => (j === i ? early : s)) : [...laneItems, early];
    }
  }

  const burst = lane.enemies.filter((h) => MAGIC_BURST.has(h.name));
  if (burst.length >= (lane.verdict === "hard" ? 1 : BURST_HEROES_FOR_RAINDROPS) && !laneItems.some((s) => keyOf(s) === "infused_raindrop")) {
    const drops = make("infused_raindrop", EARLY_MINUTE.infused_raindrop);
    if (drops) laneItems.push(mark(drops, `Against ${listNames(burst.map((h) => h.name))}'s magic burst`, burst));
  }

  laneItems.sort((a, b) => a.minute - b.minute);
  return { ...build, start, lane: laneItems };
}
