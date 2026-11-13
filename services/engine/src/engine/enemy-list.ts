/**
 * Each player's list of the five enemies, for the roadmap board: who they meet in lane (and how sure
 * that guess is), the one thing that makes each enemy dangerous, and the items in this player's path
 * that answer it, or a tip when no item does.
 */
import { DONT_FOCUS } from "./danger";
import { KEY_SPELLS, type KeySpell } from "./data-key-spells";
import { listNames, threatsOf, type ItemBuild, type Threat } from "./item-build";
import type { HeroInfo, Position } from "./types";

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
  /** The art beside the tip (see TipArt), when the tip names heroes, an item or a spell from this game. */
  tipArt?: TipArt;
}

/**
 * The picture that goes with a tip, so it reads at a glance: the heroes it names (the enemies to hit, or the
 * teammates to fight next to), the item it names (an enemy's key item, Dust), or the spell to wait out.
 */
export type TipArt = { heroes: number[]; side: "ally" | "enemy" } | { item: number; img: string } | { spell: string };

/** This game's heroes and minutes, so a tip names them instead of a rule that fits any game. */
export interface TipFacts {
  me: { hero: HeroInfo; position: Position };
  /** This player's four teammates. */
  allies: { hero: HeroInfo; position: Position }[];
  /** All five enemies, with the position the engine guessed for each (sure or not). */
  enemies: { hero: HeroInfo; position?: Position }[];
  /**
   * An enemy's key item (see game-plan.ts keyItem), only with a sure minute: the Game Story's danger lines
   * use the same rule, so the tile and the story never disagree on when it lands.
   */
  keyItems: ReadonlyMap<number, { itemId: number; name: string; img: string; minute: number }>;
  /** The items some tips name, with their art. */
  items: { dust?: { itemId: number; img: string }; blink?: { itemId: number; img: string } };
}

/** At most this many heroes named in a tip, so it stays one line of art and one sentence. */
const TIP_HEROES = 2;

/**
 * A tip for this row that names this game's heroes, spells and minutes (Can 2026-11-13: "Stay spread so one
 * combo can't catch two" fits any game). Undefined when the row has no threat kind or the facts can't
 * name anything, so the general tip stays.
 */
export function gameTip(row: ThreatRow, facts: TipFacts, spells: ReadonlyMap<number, KeySpell>): { text: string; art?: TipArt } | undefined {
  const kind = row.enemies[0]?.kind;
  const hero = (id: number) => facts.enemies.find((e) => e.hero.id === id)?.hero;
  const heroes = row.enemies.flatMap((e) => hero(e.heroId) ?? []);
  const names = listNames(heroes.map((h) => h.name));
  const first = heroes[0];
  if (!kind || !first) return undefined;
  const byPosition = <T extends { position?: Position }>(list: T[]) => [...list].sort((a, b) => (a.position ?? 9) - (b.position ?? 9));
  // The first sure key item among the row's heroes, earliest first.
  const timing = heroes
    .flatMap((h) => {
      const item = facts.keyItems.get(h.id);
      return item ? [{ hero: h, ...item }] : [];
    })
    .sort((a, b) => a.minute - b.minute)[0];
  const spellNames = (ids: number[]) =>
    ids.flatMap((id) => {
      const s = spells.get(id);
      const h = hero(id);
      return s && h ? [`${h.name}'s ${s.name}`] : [];
    });
  const firstSpell = row.enemies.map((e) => spells.get(e.heroId)).find((s) => s !== undefined);
  switch (kind) {
    case "tank": {
      // Hit the damage instead: the enemy cores who are not tanks, by position, the carry first.
      const targets = byPosition(facts.enemies.filter((e) => !DONT_FOCUS.has(e.hero.name) && !row.enemies.some((r) => r.heroId === e.hero.id)))
        .filter((e) => e.position === undefined || e.position <= 3)
        .slice(0, TIP_HEROES);
      if (!targets.length) return undefined;
      return {
        text: `Hit ${listNames(targets.map((t) => t.hero.name))} first: ${names} ${heroes.length > 1 ? "soak" : "soaks"} your damage`,
        art: { heroes: targets.map((t) => t.hero.id), side: "enemy" },
      };
    }
    case "evasion": {
      // Spells don't miss: use this player's own, or fight next to the teammates who have them.
      const casts = (p: { hero: HeroInfo }) => p.hero.roles.includes("Nuker");
      if (casts(facts.me)) return { text: `Fight ${names} with your spells: right clicks miss`, art: { heroes: [facts.me.hero.id], side: "ally" } };
      const with2 = byPosition(facts.allies.filter(casts)).slice(0, TIP_HEROES);
      if (!with2.length) return undefined;
      return {
        text: `Fight ${names} next to ${listNames(with2.map((c) => c.hero.name))}: spells don't miss, right clicks do`,
        art: { heroes: with2.map((c) => c.hero.id), side: "ally" },
      };
    }
    case "invisible": {
      const dust = facts.items.dust;
      const art = dust ? { item: dust.itemId, img: dust.img } : undefined;
      if (facts.me.position >= 4) return { text: `Carry Dust and a Sentry Ward for ${names}`, ...(art ? { art } : {}) };
      const supports = facts.allies.filter((a) => a.position >= 4).map((a) => a.hero.name);
      if (!supports.length) return undefined;
      return { text: `Ask ${listNames(supports)} for Dust and Sentries before fighting ${names}`, ...(art ? { art } : {}) };
    }
    case "heal":
      return { text: `Kill ${names} first, or keep the fight short`, art: { heroes: heroes.map((h) => h.id).slice(0, TIP_HEROES), side: "enemy" } };
    case "illusions":
      return { text: `Find the real ${names} and hit only that one`, art: { heroes: heroes.map((h) => h.id).slice(0, TIP_HEROES), side: "enemy" } };
    case "passives":
      if (timing) return { text: `${timing.hero.name} gets ${timing.name} at ${timing.minute} min: fight before it, never head on after`, art: { item: timing.itemId, img: timing.img } };
      return { text: `Catch ${names} hurt, never fight head on`, art: { heroes: heroes.map((h) => h.id).slice(0, TIP_HEROES), side: "enemy" } };
    case "physicalCarry":
      if (timing) return { text: `${timing.hero.name} gets ${timing.name} at ${timing.minute} min: fight before it`, art: { item: timing.itemId, img: timing.img } };
      return { text: `Fight ${names} early, before the big items`, art: { heroes: heroes.map((h) => h.id).slice(0, TIP_HEROES), side: "enemy" } };
    case "magicBurst": {
      // A Blink Dagger is when burst starts coming from the fog.
      const blink = timing && timing.itemId === facts.items.blink?.itemId ? timing : undefined;
      if (blink) return { text: `${blink.hero.name} gets Blink Dagger at ${blink.minute} min: from then, stay spread when ${blink.hero.name} is missing`, art: { item: blink.itemId, img: blink.img } };
      return { text: `Stay spread when ${names} ${heroes.length > 1 ? "are" : "is"} missing from the map`, ...(firstSpell ? { art: { spell: firstSpell.key } } : {}) };
    }
    case "disable": {
      const named = spellNames(row.enemies.map((e) => e.heroId));
      if (!named.length || !firstSpell) return undefined;
      return { text: `Keep your distance until ${listNames(named)} ${named.length > 1 ? "are" : "is"} used`, art: { spell: firstSpell.key } };
    }
    case "unattackable": {
      const named = spellNames(row.enemies.map((e) => e.heroId));
      if (!named.length || !firstSpell) return undefined;
      return { text: `Wait out ${listNames(named)} before you commit`, art: { spell: firstSpell.key } };
    }
  }
}

/**
 * The enemy list as rows, so one answer is said once: three stunners answered by Black King Bar make one
 * row, not three lines that each say "Buy Black King Bar". Each enemy goes to the answer item that
 * covers the most enemies (ties by path order); enemies without one group by their threat. Rows keep
 * the order of their first enemy, lane enemies first.
 */
export function threatRows(notes: EnemyNote[], facts?: TipFacts): ThreatRow[] {
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
  if (!facts) return [...rows.values()];
  const spells = new Map(notes.flatMap((n) => (n.spell ? [[n.heroId, n.spell] as const] : [])));
  return [...rows.values()].map((row) => {
    if (row.tip === undefined) return row;
    const tip = gameTip(row, facts, spells);
    return tip ? { ...row, tip: tip.text, ...(tip.art ? { tipArt: tip.art } : {}) } : row;
  });
}
