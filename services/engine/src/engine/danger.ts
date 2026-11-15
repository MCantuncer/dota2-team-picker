import { listNames } from "./item-build";

/**
 * Danger heroes for the Game Story: the one or two enemies who decide the game, each with when
 * they come online and which of our heroes they beat. Only their cores (pos 1 to 3) count: a support
 * who wins matchups still dies first in a fight. Their timing is their first big item, the one
 * their power comes from (Phantom Assassin's Battle Fury or Desolator, not her late BKB).
 */

/**
 * Tanks that win the fight when a team spends its spells on them first, so the answer is to kill
 * their damage dealers instead. Hand-kept: OpenDota's "Durable" role also covers Huskar and
 * Spectre, who should be focused.
 */
export const DONT_FOCUS = new Set([
  "Bristleback", "Centaur Warrunner", "Tidehunter", "Axe", "Mars", "Underlord", "Dragon Knight",
  "Timbersaw", "Pudge", "Abaddon", "Primal Beast",
]);

/** At most this many danger heroes, so the section stays a few seconds to read. */
export const DANGER_HEROES = 2;
/** An enemy's minute is shown as sure only when its position guess is at least this likely. */
export const SURE_POSITION_ODDS = 0.6;

export interface DangerFacts {
  hero: string;
  /**
   * "threat" beats several of our heroes; "carry" is their likely pos 1 who outscales over time;
   * "initiator" is a core who starts their fights from a sure item minute (Tidehunter's Blink Dagger).
   */
  kind: "threat" | "carry" | "initiator";
  item?: { name: string; minute: number };
  /** False when the minute comes from a build mixed over the hero's positions, so it is only "around". */
  isSure: boolean;
  /** Our heroes this enemy beats in this rank's matchup data, by name, for a threat. */
  beats?: string[];
}

/**
 * Which enemies to warn about: the biggest threat, then their carry, then the next threat, then
 * the cores who start their fights. `threats` are enemy hero ids that beat our team, biggest first;
 * `carry` is their sure pos 1; `initiators` start fights from a sure item minute, earliest first.
 */
export function chooseDangerHeroes(
  threats: number[],
  carry: number | undefined,
  initiators: number[] = [],
): { id: number; kind: DangerFacts["kind"] }[] {
  const ids = [...threats.slice(0, 1), ...(carry !== undefined ? [carry] : []), ...threats, ...initiators];
  const kind = (id: number): DangerFacts["kind"] =>
    id === carry && id !== threats[0] ? "carry" : threats.includes(id) ? "threat" : "initiator";
  return ids
    .filter((id, i) => ids.indexOf(id) === i)
    .slice(0, DANGER_HEROES)
    .map((id) => ({ id, kind: kind(id) }));
}

/**
 * "Shadow Fiend: Eul's Scepter of Divinity at 11 min. Strong against Puck and Mars." Only what the data measured:
 * the enemy's key item minute, and for a threat the heroes of ours it beats. No hand-written advice
 * (Can, 2026-11-15: no generic Game Story lines).
 */
export function dangerLine(f: DangerFacts): string {
  const item = f.item && `${f.item.name} ${f.isSure ? "at" : "around"} ${f.item.minute} min.`;
  const beats = f.kind === "threat" ? `Strong against ${f.beats?.length ? listNames(f.beats) : "your team"}.` : undefined;
  // A carry or initiator is only chosen with a sure item minute; the kind is the fact left without one.
  const what = item || beats ? undefined : f.kind === "carry" ? "Likely enemy carry." : "Starts the enemy's fights.";
  return `${f.hero}: ${[item, beats, what].filter(Boolean).join(" ")}`;
}
