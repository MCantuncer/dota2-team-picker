import type { Position } from "./types";

/**
 * "If it goes wrong" lines for Game Story: hand-written per role and situation, filled with this
 * game's heroes, items and minutes. The site cannot see the live game, so each line starts from a
 * situation the player recognises themselves ("No BKB by 24 min?"). The rules that pick which
 * lines a player sees come later; this file holds the text and fills it.
 */

/** The bad (or good) turns a fallback answers. */
export type Situation = "laneLost" | "keyItemLate" | "carryFree" | "behindAt20" | "aheadAt20";

/** Which team gets stronger later: ours, theirs, or neither clearly. */
export type Scaling = "ours" | "theirs" | "even";

/** Values a template can name. A template is only used when every slot it names has a value. */
export interface FallbackSlots {
  /** This player's hero. */
  hero?: string;
  /** This player's key item and its slower-than-most minute. */
  item?: string;
  minute?: number;
  /** Our position 1 hero, and their likely position 1 and 3 heroes. */
  ourCarry?: string;
  enemyCarry?: string;
  enemyOfflaner?: string;
  /** Our carry's key item, and the enemy carry's key item and its usual minute. */
  ourKeyItem?: string;
  enemyKeyItem?: string;
  enemyMinute?: number;
}

export interface FallbackTemplate {
  situation: Situation;
  /** Positions that can get this line, or "team" for the team-wide lines. */
  for: Position[] | "team";
  /** Only for carries that farm the jungle well (true) or those that don't (false). */
  jungler?: boolean;
  /** Only when this team scales better (team lines). */
  scaling?: Scaling;
  /** The line, with {slot} placeholders. */
  text: string;
}

/**
 * Carries and cores that farm the jungle well early, so "leave the lane for the jungle" is good
 * advice for them. Matched by display name, like the lists in gameplan.ts. Medusa and Drow Ranger
 * are left out on purpose: they farm the jungle badly and should ask for a lane swap instead.
 */
export const JUNGLE_HEROES = new Set([
  "Anti-Mage", "Faceless Void", "Troll Warlord", "Lifestealer", "Ursa", "Naga Siren", "Luna",
  "Terrorblade", "Alchemist", "Slark", "Monkey King", "Bloodseeker", "Lycan", "Nature's Prophet",
  "Chaos Knight", "Juggernaut", "Legion Commander", "Axe", "Dark Seer",
]);

/**
 * Every fallback line, the preferred variant of a situation first. A later variant needs fewer
 * slots, so a line still shows when some value is missing.
 */
export const FALLBACKS: readonly FallbackTemplate[] = [
  // Carry
  { situation: "laneLost", for: [1], jungler: true, text: "Lane lost? Leave it at 5 to 6 min for the jungle and farm toward {item}. Ask your supports to stack 2 camps." },
  { situation: "laneLost", for: [1], jungler: true, text: "Lane lost? Leave it at 5 to 6 min for the jungle. Ask your supports to stack 2 camps." },
  { situation: "laneLost", for: [1], jungler: false, text: "Lane lost? Ask for a lane swap or a rotation before 7 min, and skip trades until {item}." },
  { situation: "laneLost", for: [1], jungler: false, text: "Lane lost? Ask for a lane swap or a rotation before 7 min, and skip trades." },
  { situation: "keyItemLate", for: [1], text: "No {item} by {minute} min? Don't show on the map without it. Farm the side {enemyOfflaner} is not on." },
  { situation: "keyItemLate", for: [1], text: "No {item} by {minute} min? Don't show on the map without it. Farm behind your towers." },
  // Mid
  { situation: "laneLost", for: [2], text: "Lane lost? Stop contesting runes. Push the wave, farm the near jungle, and wait for your pos 4 to rotate." },
  { situation: "keyItemLate", for: [2], text: "No {item} by {minute} min? Stop rotating and farm mid and the near camps until it is done." },
  // Offlane
  { situation: "laneLost", for: [3], text: "Lane lost? Stop contesting {enemyCarry}. Farm the jungle and stay alive for the first fights." },
  { situation: "laneLost", for: [3], text: "Lane lost? Stop contesting the lane. Farm the jungle and stay alive for the first fights." },
  { situation: "keyItemLate", for: [3], text: "No {item} by {minute} min? Don't start fights without it. Stay behind your cores and soak damage." },
  // Supports
  { situation: "laneLost", for: [4], text: "Lane lost? Leave it after 4 min. Gank mid, or stack camps for {ourCarry}." },
  { situation: "laneLost", for: [4], text: "Lane lost? Leave it after 4 min. Gank mid, or stack camps for your carry." },
  { situation: "laneLost", for: [5], text: "Lane lost? Let {ourCarry} take every last hit. Pull the near camp and keep a ward on the rune." },
  { situation: "laneLost", for: [5], text: "Lane lost? Let your carry take every last hit. Pull the near camp and keep a ward on the rune." },
  { situation: "carryFree", for: [4], text: "{enemyCarry} is farming free? Pressure that lane before 10 min. After that, take towers on the other side." },
  { situation: "carryFree", for: [4], text: "Their carry is farming free? Pressure that lane before 10 min. After that, take towers on the other side." },
  { situation: "carryFree", for: [5], text: "{enemyCarry} is farming free? Ward their jungle so your cores can catch them, and buy a Smoke before your own items." },
  { situation: "carryFree", for: [5], text: "Their carry is farming free? Ward their jungle so your cores can catch them, and buy a Smoke before your own items." },
  // Team
  { situation: "behindAt20", for: "team", scaling: "ours", text: "Behind at 20? Defend high ground until {ourCarry} has {ourKeyItem}. Catch their pos 4 and 5 out of position." },
  { situation: "behindAt20", for: "team", scaling: "ours", text: "Behind at 20? Defend high ground until your carry's items are in. Catch their pos 4 and 5 out of position." },
  { situation: "behindAt20", for: "team", scaling: "theirs", text: "Behind at 20? Don't wait for the late game. Smoke together and catch one hero before each objective." },
  { situation: "behindAt20", for: "team", scaling: "even", text: "Behind at 20? Defend towers together and only fight with your key spells ready." },
  { situation: "aheadAt20", for: "team", scaling: "theirs", text: "Ahead at 20? Take Roshan, then siege with the Aegis before {enemyCarry} has {enemyKeyItem} around {enemyMinute} min." },
  { situation: "aheadAt20", for: "team", scaling: "theirs", text: "Ahead at 20? Take Roshan, then siege with the Aegis before {enemyCarry} is ready." },
  { situation: "aheadAt20", for: "team", scaling: "theirs", text: "Ahead at 20? Take Roshan, then siege high ground with the Aegis before 30 min." },
  { situation: "aheadAt20", for: "team", scaling: "ours", text: "Ahead at 20? Keep vision in their jungle, take safe towers, and let {ourCarry} farm to full items." },
  { situation: "aheadAt20", for: "team", scaling: "ours", text: "Ahead at 20? Keep vision in their jungle, take safe towers, and let your carry farm to full items." },
  { situation: "aheadAt20", for: "team", scaling: "even", text: "Ahead at 20? Take Roshan and push one lane together with the Aegis." },
];

const SLOT = /\{(\w+)\}/g;

/** The template with its slots filled, or null when a slot it names has no value. */
export function fillFallback(template: FallbackTemplate, slots: FallbackSlots): string | null {
  let missing = false;
  const text = template.text.replace(SLOT, (_, key: string) => {
    const value = slots[key as keyof FallbackSlots];
    if (value === undefined || value === "") missing = true;
    return String(value ?? "");
  });
  return missing ? null : text;
}

/**
 * The first variant of a situation that fits this player and can be filled, or null when none
 * fits. `hero` decides the jungle variants; `scaling` the team variants.
 */
export function fallbackFor(
  situation: Situation,
  who: Position | "team",
  slots: FallbackSlots,
  scaling: Scaling = "even",
): string | null {
  const jungler = slots.hero !== undefined && JUNGLE_HEROES.has(slots.hero);
  for (const t of FALLBACKS) {
    if (t.situation !== situation) continue;
    if (who === "team" ? t.for !== "team" || t.scaling !== scaling : t.for === "team" || !t.for.includes(who)) continue;
    if (t.jungler !== undefined && t.jungler !== jungler) continue;
    const text = fillFallback(t, slots);
    if (text) return text;
  }
  return null;
}

/** Fallback lines a player or the team can show; more than this and the card stops being a quick read. */
export const MAX_FALLBACKS = 2;

/** What the rules need to know about one of our players. */
export interface PlayerFacts {
  position: Position;
  hero: string;
  /** How their lane looks: "hard" means they will probably lose it. */
  lane: "win" | "even" | "hard";
  /** Their first big item, with the minute after which they are slower than most (when known). */
  keyItem?: { name: string; lateMinute?: number };
}

/** What the rules need to know about the game. */
export interface GameFacts {
  players: PlayerFacts[];
  /** Whether our off lane (pos 3 and 4) looks hard, which leaves their carry free. */
  offLaneHard: boolean;
  scaling: Scaling;
  ourCarry?: string;
  ourKeyItem?: string;
  enemyCarry?: string;
  enemyOfflaner?: string;
}

/**
 * The fallback lines for each player (same order as `facts.players`) and for the team.
 * A player's lines go in this order, at most MAX_FALLBACKS: lane lost (their lane is hard),
 * key item late (cores, once the late minute is known), their carry is free (supports, when the
 * off lane is hard; last because it repeats the lane problem). The team gets both the
 * "behind at 20" and "ahead at 20" lines for whichever side scales better.
 */
export function pickFallbacks(facts: GameFacts): { players: string[][]; team: string[] } {
  const shared: FallbackSlots = {
    ourCarry: facts.ourCarry,
    ourKeyItem: facts.ourKeyItem,
    enemyCarry: facts.enemyCarry,
    enemyOfflaner: facts.enemyOfflaner,
  };
  const players = facts.players.map((p) => {
    const slots: FallbackSlots = { ...shared, hero: p.hero, item: p.keyItem?.name, minute: p.keyItem?.lateMinute };
    const situations: Situation[] = [
      ...(p.lane === "hard" ? (["laneLost"] as const) : []),
      ...(p.position <= 3 && p.keyItem?.lateMinute !== undefined ? (["keyItemLate"] as const) : []),
      ...(p.position >= 4 && facts.offLaneHard ? (["carryFree"] as const) : []),
    ];
    return situations
      .map((s) => fallbackFor(s, p.position, slots))
      .filter((line): line is string => line !== null)
      .slice(0, MAX_FALLBACKS);
  });
  const team = (["behindAt20", "aheadAt20"] as const)
    .map((s) => fallbackFor(s, "team", shared, facts.scaling))
    .filter((line): line is string => line !== null)
    .slice(0, MAX_FALLBACKS);
  return { players, team };
}
