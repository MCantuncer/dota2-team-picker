/**
 * Each player's list of the five enemies, for the roadmap board: who they meet in lane (and how sure
 * that guess is), the one thing that makes each enemy dangerous, and the items in this player's path
 * that answer it, or a tip when no item does.
 */
import { DONT_FOCUS } from "./danger";
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
  /** Item ids in this player's path that answer the hero; empty when no item does. */
  answers: number[];
  /** What to do instead, when no item answers the hero. */
  tip?: string;
}

/** Answer items named per enemy; more would bury the first. */
const MAX_ANSWERS = 3;

/** Most telling threat first: an illusion carry is an illusion problem before a right-click one. */
const THREAT_ORDER: Threat[] = ["illusions", "evasion", "invisible", "heal", "buffs", "passives", "magicBurst", "disable", "physicalCarry"];

const THREAT_LINE: Record<Threat, { threat: string; tip: string }> = {
  illusions: { threat: "Illusions split your damage", tip: "Hit the real hero: it is the one their team protects" },
  evasion: { threat: "Evasion: right clicks miss", tip: "Fight them with spells, not right clicks" },
  invisible: { threat: "Goes invisible", tip: "Ask your support for Dust and Sentries before fights" },
  heal: { threat: "Heals their team through fights", tip: "Kill them first or fight short and decisive" },
  buffs: { threat: "Saves allies with buffs", tip: "Wait for the save, then commit" },
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
      const answers = [...new Set(path.filter((i) => i.against?.includes(hero.id)).map((i) => i.itemId))].slice(0, MAX_ANSWERS);
      const threats = threatsOf(hero);
      const first = THREAT_ORDER.find((t) => threats.has(t));
      const tank = threats.has("disable") ? INITIATOR_TANK : TANK;
      const line = DONT_FOCUS.has(hero.name) ? tank : first ? THREAT_LINE[first] : NOTHING;
      return { heroId: hero.id, inLane, laneSure, threat: line.threat, answers, ...(answers.length ? {} : { tip: line.tip }) };
    });
}
