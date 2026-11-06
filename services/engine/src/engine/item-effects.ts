/**
 * One short line per core item on why it fits this game, naming the enemy heroes it works on: "Stops
 * disables from Lion and Lina." The line says what the item does to these enemies, from the same threats
 * the counter items use (item-build.ts threatsOf). The wording lives here, not in COUNTER_ITEMS: a counter
 * item suggests itself for some threats, while its line names who it works on. It carries no numbers: odds
 * from real games come later (item journey plan, PR 9), and only where they pass their check.
 *
 * An item with no enemy it works on gets its plain effect, so the step still says why it is there.
 * Items missing from the table get no line.
 */
import { beatsBkb, piercingSpell } from "./bkb";
import { buffsFrom } from "./dispel";
import { listNames, threatsOf, type ItemBuild, type Threat } from "./item-build";
import { dispelsEnemy } from "./item-facts";
import type { HeroInfo, ItemInfo } from "./types";

/** Enemy heroes named in one line; more would bury it. */
const MAX_NAMES = 3;

interface Effect {
  /** The threat the item answers, and the line naming the heroes that bring it. */
  answers?: { threat: Threat; line: (names: string) => string };
  /** The line when no enemy brings that threat, or for an item that answers none. */
  plain: string;
}

/**
 * By OpenDota item key. Lines name the heroes after a preposition, never with a possessive, so a list of
 * names reads right ("from Lion and Lina"). Checked against OpenDota's item constants (2026-11-03):
 * Radiance gives 25% evasion and no blind, Monkey King Bar pierces on 80% of hits, Glimmer Cape gives a
 * magic damage barrier. Healing items name the healers but say "the healing from", since a healer's heal
 * often lands on their allies.
 */
const EFFECTS: Record<string, Effect> = {
  black_king_bar: { answers: { threat: "disable", line: (n) => `Stops disables from ${n}.` }, plain: "Spell immunity for the big fights." },
  radiance: { answers: { threat: "illusions", line: (n) => `Burns down illusions from ${n}.` }, plain: "Burns everything near you, and 25% evasion." },
  assault: { answers: { threat: "physicalCarry", line: (n) => `Armor for you and your team against ${n}.` }, plain: "Armor for you and your team." },
  monkey_king_bar: { answers: { threat: "evasion", line: (n) => `Most of your hits go through evasion on ${n}.` }, plain: "Most of your hits go through evasion." },
  silver_edge: { answers: { threat: "passives", line: (n) => `Breaks passives on ${n}.` }, plain: "Invisibility to start fights." },
  spirit_vessel: { answers: { threat: "heal", line: (n) => `Cuts the healing from ${n}.` }, plain: "Cuts healing in fights." },
  skadi: { answers: { threat: "heal", line: (n) => `Cuts the healing from ${n}; your hits slow.` }, plain: "Health and a slow on every hit." },
  nullifier: { plain: "Dispels buffs on your target and slows it." },
  mjollnir: { answers: { threat: "illusions", line: (n) => `Chain lightning clears illusions from ${n}.` }, plain: "Attack speed and chain lightning." },
  bfury: { answers: { threat: "illusions", line: (n) => `Cleave hits illusions from ${n}.` }, plain: "Cleave for fast farm." },
  crimson_guard: { answers: { threat: "physicalCarry", line: (n) => `Blocks hits from ${n} for your team.` }, plain: "Blocks hits for your team." },
  gem: { answers: { threat: "invisible", line: (n) => `Shows ${n} when invisible.` }, plain: "Shows invisible heroes." },
  // Not mapped to disables: most stuns are not target spells, so naming stunners would be wrong.
  lotus_orb: { plain: "Sends target spells back." },
  pipe: { answers: { threat: "magicBurst", line: (n) => `Blocks magic burst from ${n} for your team.` }, plain: "Blocks magic damage for your team." },
  ghost: { answers: { threat: "physicalCarry", line: (n) => `Turns off right clicks from ${n} on you.` }, plain: "Turns off right clicks on you." },
  glimmer_cape: { answers: { threat: "magicBurst", line: (n) => `Hides you and blocks magic damage from ${n}.` }, plain: "Invisibility and a magic damage barrier." },
  force_staff: { answers: { threat: "physicalCarry", line: (n) => `Pushes you away from ${n}.` }, plain: "Pushes you out of trouble." },
  heavens_halberd: { answers: { threat: "physicalCarry", line: (n) => `Disarms ${n}.` }, plain: "Disarms one right-click hero." },
  blink: { plain: "Start fights from 1,200 range." },
  desolator: { plain: "-6 armor on your target." },
  phase_boots: { plain: "Armor and a burst of speed." },
  power_treads: { plain: "Attack speed and a stat to switch." },
  armlet: { plain: "Cheap damage and armor: fight now." },
};

/**
 * The line for one item against these enemies, and the heroes it names, or null for an item with no line.
 * With `name` false the line names no heroes, but still warns of disables that go through Black King Bar.
 */
export function itemEffect(key: string, enemies: HeroInfo[], name = true): { line: string; against: number[] } | null {
  // Any item that dispels an enemy you can still hit names the buffs it removes: "Dispels Decrepify from Pugna."
  const buffed = name && dispelsEnemy(key) ? enemies.filter((h) => threatsOf(h).has("unattackable")).slice(0, MAX_NAMES) : [];
  if (buffed.length) return { line: `Dispels ${listNames(buffsFrom(buffed, "unattackable"))}.`, against: buffed.map((h) => h.id) };
  const effect = EFFECTS[key];
  if (!effect) return null;
  const bkb = key === "black_king_bar";
  const answers = effect.answers;
  const named = (h: HeroInfo) => !bkb || !beatsBkb(h);
  const hit = answers && name ? enemies.filter((h) => threatsOf(h).has(answers.threat) && named(h)).slice(0, MAX_NAMES) : [];
  let line = answers && hit.length ? answers.line(listNames(hit.map((h) => h.name))) : effect.plain;
  if (bkb) {
    const pierce = enemies.flatMap((h) => piercingSpell(h) ?? []);
    if (pierce.length) line += ` ${listNames(pierce)} still ${pierce.length > 1 ? "go" : "goes"} through it.`;
  }
  return { line, against: hit.map((h) => h.id) };
}

/** The build with an effect line on each core item that has one. Start, lane and situational items are left as they are. */
export function withEffects(build: ItemBuild, enemies: HeroInfo[], items: Record<string, ItemInfo>): ItemBuild {
  const core = build.core.map((item) => {
    const key = items[item.itemId]?.key;
    // A counter item's reason already names the enemies, so its effect says what the item does, not who to.
    const effect = key ? itemEffect(key, enemies, !item.reason) : null;
    return effect ? { ...item, effect: effect.line, effectAgainst: effect.against } : item;
  });
  return { ...build, core };
}
