/**
 * Danger heroes for the Game Story: the one or two enemies who decide the game, each with when
 * they come online and what our team does about it. Only their cores (pos 1 to 3) count: a support
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

/** "Faceless Void: Black King Bar at 21 min. Take fights and towers before then." */
export function dangerLine(f: DangerFacts): string {
  const answer =
    f.kind === "carry"
      ? "Take fights and towers before then."
      : f.kind === "initiator"
        ? "From then, spread out and watch the fog."
        : DONT_FOCUS.has(f.hero)
        ? "Don't focus them: kill their damage dealers first."
        : "Lock them down first in every fight.";
  if (!f.item) return `${f.hero}: ${f.kind === "carry" ? "farms fast. Take fights early." : answer}`;
  return `${f.hero}: ${f.item.name} ${f.isSure ? "at" : "around"} ${f.item.minute} min. ${answer}`;
}
