/**
 * Each player's list of the five enemies, for the roadmap board: who they meet in lane (and how sure
 * that guess is), the one thing that makes each enemy dangerous, and the items in this player's path
 * that answer it, or a tip when no item does.
 */
import { DONT_FOCUS } from "./danger";
import { KEY_SPELLS, type KeySpell } from "./data-key-spells";
import { threatsOf, type ItemBuild, type Threat } from "./item-build";
import type { HeroInfo } from "./types";

export interface EnemyNote {
  heroId: number;
  /** In this player's lane. */
  inLane: boolean;
  /** Whether the enemy's position (and so its lane) is a sure guess. */
  laneSure: boolean;
  /** The one thing that makes this hero dangerous, in a short line. */
  threat: string;
  /** What kind of threat the line is, for an icon and a short title: "tank" for heroes not to focus. */
  kind?: Threat | "tank";
  /** Item ids in this player's path that answer the hero; empty when no item does. */
  answers: number[];
  /** What to do instead, when no item answers the hero. */
  tip?: string;
  /** The hero's spell that hurts you most, for the ability art and a short line (data-key-spells.ts). */
  spell?: KeySpell;
}

/** Items that stop spells but not right clicks, and items that stop right clicks but not spells, by item art. */
const SPELL_ONLY = ["black_king_bar", "lotus_orb", "pipe", "glimmer_cape"];
const ATTACK_ONLY = ["ghost", "heavens_halberd", "crimson_guard", "assault", "shivas_guard", "blade_mail", "monkey_king_bar"];
const itemKey = (img: string) => img.split("/").pop()?.replace(/\.png$/, "") ?? "";

/**
 * Whether an item can answer this kind of spell: Black King Bar does nothing against Marksmanship, and
 * neither it nor armor answers Black Hole.
 */
function fits(kind: KeySpell["kind"] | undefined, img: string): boolean {
  const key = itemKey(img);
  if (kind === "attack") return !SPELL_ONLY.includes(key);
  if (kind === "magic") return !ATTACK_ONLY.includes(key);
  if (kind === "other") return !SPELL_ONLY.includes(key) && !ATTACK_ONLY.includes(key);
  return true;
}

/** Answer items named per enemy; more would bury the first. */
const MAX_ANSWERS = 3;

/**
 * Most telling threat first: an illusion carry is an illusion problem before a right-click one. A buff that
 * stops attacks comes last: Necrophos heals and bursts before his Ghost Shroud matters.
 */
const THREAT_ORDER: Threat[] = ["illusions", "evasion", "invisible", "heal", "passives", "magicBurst", "disable", "physicalCarry", "unattackable"];

const THREAT_LINE: Record<Threat, { threat: string; tip: string }> = {
  illusions: { threat: "Illusions split your damage", tip: "Hit the real hero: it is the one their team protects" },
  evasion: { threat: "Evasion: right clicks miss", tip: "Fight them with spells, not right clicks" },
  invisible: { threat: "Goes invisible", tip: "Ask your support for Dust and Sentries before fights" },
  heal: { threat: "Heals their team through fights", tip: "Kill them first or fight short and decisive" },
  unattackable: { threat: "Makes heroes unable to be attacked", tip: "Dispel it, or wait it out before you commit" },
  passives: { threat: "Strong passives", tip: "Fight them when they are low, not head on" },
  magicBurst: { threat: "Magic burst", tip: "Stay spread so one combo can't catch two" },
  disable: { threat: "Locks you down", tip: "Keep distance until their disable is used" },
  physicalCarry: { threat: "Right-click carry who grows late", tip: "Fight before their big item, not after" },
};
const TANK = { threat: "Tank who soaks your damage", tip: "Don't focus them: kill their damage dealers first" };
const INITIATOR_TANK = { threat: "Starts fights and soaks your damage", tip: "Don't focus them: kill their damage dealers first" };
const NOTHING = { threat: "No special threat", tip: "Play your lane: nothing to buy for them" };

export interface EnemyFacts {
  hero: HeroInfo;
  inLane: boolean;
  laneSure: boolean;
}

/** In-lane enemies first, then the rest in pick order. */
export function enemyList(build: ItemBuild | null, enemies: EnemyFacts[]): EnemyNote[] {
  // Start items (a hard lane's Salve) are for the lane as a whole, not an answer to one hero.
  const path = build ? [...build.lane, ...build.core, ...build.situational] : [];
  return [...enemies]
    .sort((a, b) => Number(b.inLane) - Number(a.inLane))
    .map(({ hero, inLane, laneSure }) => {
      const spell = KEY_SPELLS[hero.name];
      // An answer must stop the hero's worst spell, or the row would pair Marksmanship with Black King Bar.
      const answers = [...new Set(path.filter((i) => i.against?.includes(hero.id) && fits(spell?.kind, i.img)).map((i) => i.itemId))].slice(0, MAX_ANSWERS);
      const threats = threatsOf(hero);
      const first = THREAT_ORDER.find((t) => threats.has(t));
      const tank = threats.has("disable") ? INITIATOR_TANK : TANK;
      const line = DONT_FOCUS.has(hero.name) ? tank : first ? THREAT_LINE[first] : NOTHING;
      const kind = DONT_FOCUS.has(hero.name) ? "tank" : first;
      return {
        heroId: hero.id,
        inLane,
        laneSure,
        threat: line.threat,
        ...(kind ? { kind } : {}),
        answers,
        ...(answers.length ? {} : { tip: line.tip }),
        ...(spell ? { spell } : {}),
      };
    });
}

/** Enemies that share an answer item (or, without one, the same threat) shown as one row. */
export interface ThreatRow {
  /** The enemies in this row, lane enemies first, each with its own threat (an answer item covers the
   * heroes, not every threat they bring). */
  enemies: Pick<EnemyNote, "heroId" | "inLane" | "laneSure" | "threat" | "kind">[];
  /** The item in this player's path that answers them all, when one does. */
  answer?: number;
  /** What to do instead, when no item answers them. */
  tip?: string;
}

/**
 * The enemy list as rows, so one answer is said once: three stunners answered by Black King Bar make one
 * row, not three lines that each say "Buy Black King Bar". Each enemy goes to the answer item that
 * covers the most enemies (ties by path order); enemies without one group by their threat. Rows keep
 * the order of their first enemy, lane enemies first.
 */
export function threatRows(notes: EnemyNote[]): ThreatRow[] {
  const covers = new Map<number, number>();
  for (const n of notes) for (const id of n.answers) covers.set(id, (covers.get(id) ?? 0) + 1);
  // Path order breaks ties: reduce keeps the earlier answer unless a later one covers more enemies.
  const best = (n: EnemyNote) =>
    n.answers.reduce<number | undefined>((b, id) => (b === undefined || (covers.get(id) ?? 0) > (covers.get(b) ?? 0) ? id : b), undefined);
  const rows = new Map<string, ThreatRow>();
  for (const note of notes) {
    const answer = best(note);
    const key = answer !== undefined ? `item:${answer}` : `threat:${note.threat}`;
    const row: ThreatRow =
      rows.get(key) ?? { enemies: [], ...(answer !== undefined ? { answer } : note.tip !== undefined ? { tip: note.tip } : {}) };
    const { heroId, inLane, laneSure, threat, kind } = note;
    row.enemies.push({ heroId, inLane, laneSure, threat, ...(kind ? { kind } : {}) });
    rows.set(key, row);
  }
  return [...rows.values()];
}
