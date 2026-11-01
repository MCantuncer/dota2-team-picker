/**
 * Danger heroes for the Game Story: the one or two enemies who decide the game, each with when
 * they come online and what our team does about it. Their timing is their BKB when they buy one,
 * else their first big item, because that is when fighting them gets hard (Game Story plan).
 */

/** At most this many danger heroes, so the section stays a few seconds to read. */
export const DANGER_HEROES = 2;
/** An enemy's minute is shown as sure only when its position guess is at least this likely. */
export const SURE_POSITION_ODDS = 0.6;

export interface DangerFacts {
  hero: string;
  /** "threat" beats several of our heroes; "carry" is their likely pos 1 who outscales over time. */
  kind: "threat" | "carry";
  item?: { name: string; minute: number };
  /** False when the enemy's position is a close guess, so its minute is only "around". */
  isSure: boolean;
}

/**
 * Which enemies to warn about: the biggest threat, then their carry, then the next threat.
 * `threats` are enemy hero ids that beat our team, biggest first; `carry` is their likely pos 1.
 */
export function chooseDangerHeroes(threats: number[], carry: number | undefined): { id: number; kind: DangerFacts["kind"] }[] {
  const ids = [...threats.slice(0, 1), ...(carry !== undefined ? [carry] : []), ...threats];
  return ids
    .filter((id, i) => ids.indexOf(id) === i)
    .slice(0, DANGER_HEROES)
    .map((id) => ({ id, kind: id === carry && id !== threats[0] ? "carry" : "threat" }));
}

/** "Faceless Void: Black King Bar at 21 min. Take fights and towers before then." */
export function dangerLine(f: DangerFacts): string {
  const answer = f.kind === "carry" ? "Take fights and towers before then." : "Lock them down first in every fight.";
  if (!f.item) return `${f.hero}: ${f.kind === "carry" ? "farms fast. Take fights early." : answer}`;
  return `${f.hero}: ${f.item.name} ${f.isSure ? "at" : "around"} ${f.item.minute} min. ${answer}`;
}
