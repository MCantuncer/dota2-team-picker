/**
 * One short line per core item on why it fits this game, naming the enemy heroes it works on: "Stops
 * their stuns: Ogre Magi and Witch Doctor." The line says what the item does to these enemies, from the
 * same threats the counter items use (item-build.ts threatsOf). It carries no numbers: odds from real
 * games come later (item journey plan, PR 9), and only where they pass their check.
 *
 * An item with no enemy it works on gets its plain effect, so the step still says why it is there.
 * Items missing from the table get no line.
 */
import { listNames, threatsOf, type ItemBuild, type Threat } from "./item-build";
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
 * Ultimates that go through spell immunity, by hero, so Black King Bar never reads as the answer to them.
 * Kept to the certain ones; a wrong "it still goes through" is worse than none.
 */
const PIERCING_ULTIMATES: Record<string, string> = {
  Enigma: "Black Hole",
  "Faceless Void": "Chronosphere",
  "Legion Commander": "Duel",
  Doom: "Doom",
};

/** By OpenDota item key. */
const EFFECTS: Record<string, Effect> = {
  black_king_bar: { answers: { threat: "disable", line: (n) => `Stops their stuns: ${n}.` }, plain: "Spell immunity for the big fights." },
  radiance: { answers: { threat: "illusions", line: (n) => `Burns down ${n}'s illusions.` }, plain: "Burns everything near you, and 25% evasion." },
  assault: { answers: { threat: "physicalCarry", line: (n) => `Armor for you and your team against ${n}.` }, plain: "Armor for you and your team." },
  monkey_king_bar: { answers: { threat: "evasion", line: (n) => `Your hits can't miss ${n}.` }, plain: "Hits that can't miss." },
  silver_edge: { answers: { threat: "passives", line: (n) => `Breaks ${n}'s passives.` }, plain: "Invisibility to start fights." },
  spirit_vessel: { answers: { threat: "heal", line: (n) => `Cuts ${n}'s healing.` }, plain: "Cuts healing in fights." },
  skadi: { answers: { threat: "heal", line: (n) => `Cuts ${n}'s healing and slows them.` }, plain: "Health and a slow on every hit." },
  nullifier: { answers: { threat: "buffs", line: (n) => `Dispels the saves ${n} cast.` }, plain: "Dispels saves on your target." },
  mjollnir: { answers: { threat: "illusions", line: (n) => `Chain lightning clears ${n}'s illusions.` }, plain: "Attack speed and chain lightning." },
  bfury: { answers: { threat: "illusions", line: (n) => `Cleave hits ${n}'s illusions.` }, plain: "Cleave for fast farm." },
  crimson_guard: { answers: { threat: "physicalCarry", line: (n) => `Blocks hits from ${n} for your team.` }, plain: "Blocks hits for your team." },
  gem: { answers: { threat: "invisible", line: (n) => `Shows ${n} when invisible.` }, plain: "Shows invisible heroes." },
  lotus_orb: { answers: { threat: "disable", line: (n) => `Sends ${n}'s target spells back.` }, plain: "Sends target spells back." },
  pipe: { answers: { threat: "magicBurst", line: (n) => `Blocks ${n}'s magic burst for your team.` }, plain: "Blocks magic damage for your team." },
  ghost: { answers: { threat: "physicalCarry", line: (n) => `Turns off ${n}'s right clicks on you.` }, plain: "Turns off right clicks on you." },
  glimmer_cape: { answers: { threat: "magicBurst", line: (n) => `Magic resistance against ${n}.` }, plain: "Invisibility and magic resistance." },
  force_staff: { answers: { threat: "physicalCarry", line: (n) => `Pushes you out of ${n}'s reach.` }, plain: "Pushes you out of trouble." },
  heavens_halberd: { answers: { threat: "physicalCarry", line: (n) => `Disarms ${n}.` }, plain: "Disarms one right-click hero." },
  blink: { plain: "Start fights from 1,200 range." },
  desolator: { plain: "-6 armor on your target." },
  phase_boots: { plain: "Armor and a burst of speed." },
  power_treads: { plain: "Attack speed and a stat to switch." },
  armlet: { plain: "Cheap damage and armor: fight now." },
};

/** The line for one item against these enemies, and the heroes it names, or null for an item with no line. */
export function itemEffect(key: string, enemies: HeroInfo[]): { line: string; against: number[] } | null {
  const effect = EFFECTS[key];
  if (!effect) return null;
  const hit = effect.answers ? enemies.filter((h) => threatsOf(h).has(effect.answers!.threat)).slice(0, MAX_NAMES) : []; // `answers` checked first.
  if (!effect.answers || !hit.length) return { line: effect.plain, against: [] };
  let line = effect.answers.line(listNames(hit.map((h) => h.name)));
  if (key === "black_king_bar") {
    const piercer = enemies.find((h) => PIERCING_ULTIMATES[h.name]);
    if (piercer) line += ` ${PIERCING_ULTIMATES[piercer.name]} still goes through it.`;
  }
  return { line, against: hit.map((h) => h.id) };
}

/** The build with an effect line on each core item that has one. Start, lane and situational items are left as they are. */
export function withEffects(build: ItemBuild, enemies: HeroInfo[], items: Record<string, ItemInfo>): ItemBuild {
  const core = build.core.map((item) => {
    const key = items[item.itemId]?.key;
    const effect = key ? itemEffect(key, enemies) : null;
    return effect ? { ...item, effect: effect.line, effectAgainst: effect.against } : item;
  });
  return { ...build, core };
}
