/**
 * Lane tactics: rules for one hero against one enemy laner, worked out from the 7.42 game numbers
 * (lane-facts.ts) and the skill builds high-rank players use (lane-skills.ts). Every tactic is one of a fixed
 * set of rules over those facts, run the same way for every pair of heroes; no hero or spell is named in a
 * rule. A rule speaks only when its numbers say it matters, and the tactics are ranked by how much of a
 * hero's health is at stake, so the first one answers "what should I care about most".
 */
import { atLevel, damageTaken, heroStatsAt, laneHero, laneSpell, type HeroStats, type LaneHero, type LaneSpell } from "./lane-facts";
import { firstLevelOf, levelFor, spellLevelsAt, type SpellLevels } from "./lane-skills";
import type { LaneCounts, Position, Snapshot } from "./types";

export type LaneRule = "killLine" | "yourSpell" | "trade" | "reach" | "auraEdge" | "split" | "lineUp" | "dodge" | "window" | "lastHits";

/** A piece of a tactic's sentence; `strong` marks the part to act on. */
export interface TextPart {
  text: string;
  strong?: true;
}

/** One bar of a range ruler: a spell's or a hero's reach, on our side or the enemy's. */
export interface RangeBar {
  side: "ours" | "enemy";
  range: number;
  spell?: string;
  hero?: number;
}

/** One row of a timing bar, in seconds. */
export interface TimingRow {
  spell?: string;
  hero?: number;
  seconds: number;
  /** "open" is time to act; "busy" is the enemy's spell or cooldown. */
  kind: "open" | "busy";
  label: string;
}

/** The picture a tactic is drawn with. */
export type TacticVisual =
  | { kind: "killLine"; health: number; total: number; parts: { spell?: string; label: string; amount: number }[] }
  | { kind: "ruler"; bars: RangeBar[] }
  | { kind: "trade"; hit: number; hits: number; heal: number; casts: number }
  | { kind: "split"; width: number; spell: string; summon: string }
  /** A line spell through the wave: `blocked` when the first creep stops it, so behind the creeps is safe. */
  | { kind: "lineUp"; width: number; spell: string; blocked: boolean }
  | { kind: "timing"; rows: TimingRow[] }
  /** Average lane last hits: ours against this enemy, ours against everyone, and the enemy's against us. */
  | { kind: "lastHits"; target: number; usual: number; enemy?: number };

export interface LaneTactic {
  rule: LaneRule;
  /** Short label above the title, like "Your Spell". */
  tag: string;
  title: string;
  parts: TextPart[];
  /** Ability keys whose icons go with the tactic, most important first. */
  spells: string[];
  visual?: TacticVisual;
  /** Share of a hero's health at stake (0 to 1), for ranking. */
  weight: number;
}

/** Hero levels the rules look at: the trading levels of the early lane, and the first ultimate. */
const EARLY_LEVEL = 3;
const ULT_LEVEL = 6;
/** A kill line shows once the enemy's burst passes this share of our health. */
const KILL_LINE_SHARE = 0.4;
/** Attack ranges closer than this are no reach advantage (melee against melee never is). */
const MIN_RANGE_GAP = 150;
/** A window needs this long a cooldown to be worth waiting for. */
const MIN_WINDOW_SECONDS = 8;
/** The enemy's nuke must take this share of our health for its cooldown to be a trade window. */
const MIN_WINDOW_SHARE = 0.12;
/** Our spell on the wave is worth a card only when it takes this share of the enemy's health. */
const MIN_SPELL_SHARE = 0.1;
/** Spells reaching at least this far count as ranged damage for the trade window. */
const RANGED_SPELL = 500;
/** Spells an orb hero (Invoker) has ready at once. */
const INVOKED_SLOTS = 2;
/** Hits counted after the enemy's stuns end, for the time it takes to react. */
const REACTION_HITS = 1;
/** A last hit target needs this many lanes of the pair behind it (the lane download keeps 300 and up). */
const MIN_LAST_HIT_LANES = 300;
/** At most this many tactics are returned: three cards and three quieter tips. */
export const MAX_TACTICS = 6;

const r = (n: number) => Math.round(n);
const s = (n: number) => String(Math.round(n * 100) / 100);
/** Rounds a health line up to the next 50, so "stay above" has a little room. */
const roundUp50 = (n: number) => Math.ceil(n / 50) * 50;

/** One side of a lane at a level: the hero, its stats and the spell levels its build has. */
interface Side {
  id: number;
  name: string;
  hero: LaneHero;
  stats: HeroStats;
  levels: SpellLevels;
}

/** Whether a side has a spell at its level: its own points, or every ability it is levelled by. */
function has(side: Side, key: string): boolean {
  const spell = laneSpell(key);
  const from = Object.values(spell?.levelFrom ?? {});
  return from.length ? from.every((k) => (side.levels.get(k) ?? 0) > 0) : (side.levels.get(key) ?? 0) > 0;
}

/** A side's spells it has at its level, with their facts. */
function spellsOf(side: Side): LaneSpell[] {
  return side.hero.spells.flatMap((k) => (has(side, k) ? [laneSpell(k)].filter((x): x is LaneSpell => !!x) : []));
}

/** A spell value at the side's level of that spell (or of the ability that levels the field). */
const valueOf = (side: Side, spell: LaneSpell, values: number[] | undefined, field?: "damage" | "summonHealth") => atLevel(values, levelFor(side.levels, spell.key, field));

/** Damage one cast of an enemy spell does to `target`, after resistances. */
function spellHit(caster: Side, spell: LaneSpell, target: HeroStats): number {
  const raw = valueOf(caster, spell, spell.damage, "damage") ?? 0;
  return damageTaken(raw, spell.damageType ?? "magical", target);
}

const casts = (spells: LaneSpell[]) => spells.filter((sp) => !sp.passive && sp.damage);

/**
 * The most health an execute that scales with missing health (Reaper's Scythe) kills from, after resistances: with
 * k damage per missing point and max health H, a hero at h dies when k(H - h) >= h, so up to kH / (1 + k). That is
 * also what the execute adds to a kill line, as the rest of the combo has to bring the hero down to it.
 */
function executeLine(caster: Side, spell: LaneSpell, target: HeroStats): number {
  const perPoint = damageTaken(valueOf(caster, spell, spell.missingHealthDamage) ?? 0, spell.damageType ?? "magical", target);
  return (perPoint * target.health) / (1 + perPoint);
}

function killLine(me: Side, enemy: Side): LaneTactic | undefined {
  // Every damaging spell once, cheapest first, as long as the enemy has the mana for it.
  const all = spellsOf(enemy)
    .filter((sp) => !sp.passive && (sp.damage || sp.missingHealthDamage))
    .map((sp) => ({ sp, cost: valueOf(enemy, sp, sp.mana) ?? 0, hit: sp.damage ? spellHit(enemy, sp, me.stats) : executeLine(enemy, sp, me.stats) }))
    .filter((u) => u.hit > 0);
  // Orb-levelled spells are invoked, and only INVOKED_SLOTS are ready at once: the strongest of them.
  const invoked = new Set(
    all
      .filter((u) => u.sp.levelFrom)
      .sort((a, b) => b.hit - a.hit)
      .slice(INVOKED_SLOTS)
      .map((u) => u.sp.key),
  );
  const options = all.filter((u) => !invoked.has(u.sp.key)).sort((a, b) => a.cost - b.cost);
  const used: typeof options = [];
  let mana = enemy.stats.mana;
  for (const option of options) {
    if (option.cost > mana) break;
    mana -= option.cost;
    used.push(option);
  }
  if (!used.length) return undefined;
  const stun = used.reduce((t, u) => t + (valueOf(enemy, u.sp, u.sp.stun) ?? 0), 0);
  const hits = Math.max(2, Math.floor(stun / enemy.stats.attackInterval) + REACTION_HITS);
  const hit = damageTaken(enemy.stats.attackDamage, "physical", me.stats);
  const parts = [...used.map((u) => ({ spell: u.sp.key, label: u.sp.name, amount: r(u.hit) })), { label: `${hits} Hits`, amount: r(hit * hits) }];
  const total = parts.reduce((t, p) => t + p.amount, 0);
  if (total < me.stats.health * KILL_LINE_SHARE) return undefined;
  const names = used.map((u) => u.sp.name);
  const combo = `${[...names, `${hits} hits`].join(", ").replace(/, ([^,]*)$/, " and $1")} deal ${total} of your ${r(me.stats.health)} HP after your armor and magic resistance.`;
  if (total >= me.stats.health) {
    // No health line is safe: the answer is distance from the spell that starts the combo.
    const opener = [...used].sort((a, b) => (atLevel(b.sp.castRange, 1) ?? 0) - (atLevel(a.sp.castRange, 1) ?? 0))[0];
    const reach = opener && atLevel(opener.sp.castRange, 1);
    return {
      rule: "killLine",
      tag: `Level ${ULT_LEVEL}`,
      title: `${enemy.name}'s Level ${ULT_LEVEL} Combo Kills You From Full HP`,
      parts: [
        { text: `Once ${enemy.name} is level ${ULT_LEVEL}, ` },
        { text: reach && opener ? `stay out of ${opener.sp.name} range (${reach}) unless your team is near` : "never fight alone", strong: true },
        { text: `. ${combo}` },
      ],
      spells: [...used].sort((a, b) => b.hit - a.hit).map((u) => u.sp.key),
      visual: { kind: "killLine", health: r(me.stats.health), total, parts },
      weight: total / me.stats.health,
    };
  }
  return {
    rule: "killLine",
    tag: `Level ${ULT_LEVEL}`,
    title: `${enemy.name}'s Level ${ULT_LEVEL} Kill Line`,
    parts: [
      { text: `Once ${enemy.name} is level ${ULT_LEVEL}, ` },
      { text: `stay above ${roundUp50(total)} HP`, strong: true },
      { text: `. ${combo}` },
    ],
    spells: [...used].sort((a, b) => b.hit - a.hit).map((u) => u.sp.key),
    visual: { kind: "killLine", health: r(me.stats.health), total, parts },
    weight: total / me.stats.health,
  };
}

function yourSpell(me: Side, enemy: Side): LaneTactic | undefined {
  // An area or line spell that hits creeps and heroes; one cast around the caster reads best, then any other.
  // Orb-levelled spells (Invoker's) are left out: which orbs a cast needs is not in the facts.
  const area = casts(spellsOf(me)).filter((sp) => sp.hitsUnits && !sp.stopsAtFirstUnit && !sp.levelFrom && (atLevel(sp.radius, 1) || sp.length));
  const spell = area.find((sp) => sp.cast === "none") ?? area[0];
  const radius = spell && (spell.cast === "none" ? atLevel(spell.radius, 1) : (atLevel(spell.castRange, 1) ?? spell.length));
  if (!spell || !radius) return undefined;
  const dmg = r(spellHit(me, spell, enemy.stats));
  if (dmg < enemy.stats.health * MIN_SPELL_SHARE) return undefined;
  const heal = valueOf(me, spell, spell.heal);
  const cooldown = valueOf(me, spell, spell.cooldown);
  const outranged = enemy.stats.attackRange > radius;
  const gain = `${dmg} to ${enemy.name}${heal ? `, ${heal} back to you` : ""}`;
  return {
    rule: "yourSpell",
    tag: "Your Spell",
    title: outranged ? `${spell.name} When ${enemy.name} Steps In` : `${spell.name} the Wave and ${enemy.name}`,
    parts: [
      {
        text: outranged
          ? `${enemy.name} hits from ${enemy.stats.attackRange}, ${spell.name} reaches ${radius}. Cast it when ${enemy.name} walks in for a last hit: `
          : `${spell.name} reaches ${radius}, past ${enemy.name}'s ${enemy.stats.attackRange}. Cast it when the wave is low and ${enemy.name} is near: `,
      },
      { text: gain, strong: true },
      { text: `, and the creeps it finishes${cooldown ? `, every ${s(cooldown)} s` : ""}.` },
    ],
    spells: [spell.key],
    visual: { kind: "ruler", bars: [{ side: "ours", range: radius, spell: spell.key }, { side: "enemy", range: enemy.stats.attackRange, hero: enemy.id }] },
    weight: (dmg + (heal ?? 0)) / enemy.stats.health,
  };
}

function trade(me: Side, enemy: Side): LaneTactic | undefined {
  const spell = casts(spellsOf(me)).find((sp) => valueOf(me, sp, sp.heal));
  const heal = spell && valueOf(me, spell, spell.heal);
  const cost = spell && valueOf(me, spell, spell.mana);
  if (!spell || !heal || !cost) return undefined;
  const hit = r(damageTaken(enemy.stats.attackDamage, "physical", me.stats));
  const hits = Math.floor(heal / hit);
  const count = Math.floor(me.stats.mana / cost);
  if (hits < 1 || count < 1) return undefined;
  return {
    rule: "trade",
    tag: "Last Hits",
    title: `Trade ${hits === 1 ? "a Hit" : `${hits} Hits`} for a Last Hit`,
    parts: [
      { text: `At level ${EARLY_LEVEL} each ${enemy.name} hit costs you ${hit}. One ${spell.name} gives ${heal} back, and ${r(me.stats.mana)} mana holds ${count}, so ` },
      { text: `take ${hits === 1 ? "a hit" : `${hits} hits`} for a contested last hit`, strong: true },
      { text: ` while you have the mana.` },
    ],
    spells: [spell.key],
    visual: { kind: "trade", hit, hits, heal, casts: count },
    weight: (heal * count) / me.stats.health / 2,
  };
}

function reach(me: Side, enemy: Side): LaneTactic | undefined {
  const gap = me.stats.attackRange - enemy.stats.attackRange;
  if (Math.abs(gap) < MIN_RANGE_GAP) return undefined;
  const bars: RangeBar[] = [{ side: "ours", range: me.stats.attackRange, hero: me.id }, { side: "enemy", range: enemy.stats.attackRange, hero: enemy.id }];
  if (gap > 0) {
    return {
      rule: "reach",
      tag: "Reach",
      title: `${enemy.name} Has to Walk ${gap} to Hit You`,
      parts: [
        { text: `Your attack reaches ${me.stats.attackRange}, ${enemy.name}'s ${enemy.stats.attackRange}. ` },
        { text: `Hit ${enemy.name} each time they walk up for a last hit`, strong: true },
        { text: " and step back before they reach you." },
      ],
      spells: [],
      visual: { kind: "ruler", bars },
      weight: (damageTaken(me.stats.attackDamage, "physical", enemy.stats) * 3) / enemy.stats.health,
    };
  }
  return {
    rule: "reach",
    tag: "Reach",
    title: `${enemy.name} Outranges You by ${-gap}`,
    parts: [
      { text: `${enemy.name} hits from ${enemy.stats.attackRange}, you from ${me.stats.attackRange}. ` },
      { text: "Stand behind your creeps and step in only to last hit", strong: true },
      { text: `, or every step costs you ${r(damageTaken(enemy.stats.attackDamage, "physical", me.stats))} HP.` },
    ],
    spells: [],
    visual: { kind: "ruler", bars },
    weight: (damageTaken(enemy.stats.attackDamage, "physical", me.stats) * 3) / me.stats.health,
  };
}

function auraEdge(me: Side, enemy: Side): LaneTactic | undefined {
  const spell = spellsOf(me).find((sp) => sp.aura && sp.aura.radius > enemy.stats.attackRange);
  const pct = spell?.aura && valueOf(me, spell, spell.aura.healthPerSecondPct);
  if (!spell?.aura || !pct) return undefined;
  const perSecond = damageTaken((enemy.stats.health * pct) / 100, "magical", enemy.stats);
  return {
    rule: "auraEdge",
    tag: "Your Aura",
    title: `Your Aura Outranges ${enemy.name}`,
    parts: [
      { text: `${spell.name} reaches ${spell.aura.radius}, ${enemy.name}'s attack ${enemy.stats.attackRange}. ` },
      { text: `Every time ${enemy.name} hits you, they lose ${s(Math.round(perSecond * 10) / 10)} HP a second`, strong: true },
      { text: ` at your aura's level ${levelFor(me.levels, spell.key)}.` },
    ],
    spells: [spell.key],
    visual: { kind: "ruler", bars: [{ side: "enemy", range: enemy.stats.attackRange, hero: enemy.id }, { side: "ours", range: spell.aura.radius, spell: spell.key }] },
    weight: (perSecond * 10) / enemy.stats.health,
  };
}

/** An enemy spell that hits everything in a line or area, with damage: the one a summon or wave lines up for. */
const areaHits = (enemy: Side) => casts(spellsOf(enemy)).filter((sp) => sp.hitsUnits && (sp.width || atLevel(sp.radius, 1)));

function split(me: Side, enemy: Side): LaneTactic | undefined {
  const summon = spellsOf(me).find((sp) => sp.summonHealth);
  const spell = areaHits(enemy).find((sp) => sp.width);
  const health = summon && valueOf(me, summon, summon.summonHealth, "summonHealth");
  if (!summon || !spell?.width || !health) return undefined;
  const toYou = r(spellHit(enemy, spell, me.stats));
  const toSummon = r(valueOf(enemy, spell, spell.damage, "damage") ?? 0);
  return {
    rule: "split",
    tag: "Positioning",
    title: `Split From Your ${summon.name}`,
    parts: [
      { text: `${spell.name} is a ${spell.width} wide line. ` },
      { text: `Stand ${spell.width} to the side of your ${summon.name}, never behind it`, strong: true },
      { text: `: one cast through both deals ${toYou} to you and ${toSummon} of its ${health} HP.` },
    ],
    spells: [spell.key, summon.key],
    visual: { kind: "split", width: spell.width, spell: spell.key, summon: summon.key },
    weight: (toYou + toSummon) / me.stats.health,
  };
}

function lineUp(me: Side, enemy: Side): LaneTactic | undefined {
  const lines = areaHits(enemy).filter((sp) => sp.width && sp.length && sp.cast === "point");
  // A hook or an arrow stops at the first creep: the creeps are cover, the opposite of a wave-wide line.
  const blocked = lines.find((sp) => sp.stopsAtFirstUnit);
  if (blocked?.width && blocked.length) {
    const toYou = r(spellHit(enemy, blocked, me.stats));
    return {
      rule: "lineUp",
      tag: "Positioning",
      title: `Keep a Creep Between You and ${enemy.name}`,
      parts: [
        { text: `${blocked.name} stops at the first unit it touches. ` },
        { text: "Stand behind your creeps", strong: true },
        { text: `, never in the open within ${blocked.length}: a creep takes it for you, else ${toYou} to you.` },
      ],
      spells: [blocked.key],
      visual: { kind: "lineUp", width: blocked.width, spell: blocked.key, blocked: true },
      weight: (toYou * 1.2) / me.stats.health,
    };
  }
  const spell = lines.find((sp) => !sp.stopsAtFirstUnit);
  if (!spell?.width || !spell.length) return undefined;
  const toYou = r(spellHit(enemy, spell, me.stats));
  return {
    rule: "lineUp",
    tag: "Positioning",
    title: "Don't Stand Behind Your Creeps",
    parts: [
      { text: `${spell.name} runs ${spell.length} through the wave, ${spell.width} wide. ` },
      { text: "Never stand in line behind your creeps", strong: true },
      { text: `: one cast hits both, ${toYou} to you.` },
    ],
    spells: [spell.key],
    visual: { kind: "lineUp", width: spell.width, spell: spell.key, blocked: false },
    weight: toYou / me.stats.health,
  };
}

function dodge(me: Side, enemy: Side, data: Snapshot, enemyPosition: Position): LaneTactic | undefined {
  // Any delayed area spell the enemy takes in lane, even one not learned by level 3.
  const spell = enemy.hero.spells
    .map((k) => laneSpell(k))
    .find((sp): sp is LaneSpell => !!sp && !sp.passive && sp.cast === "point" && !!sp.delay && !!atLevel(sp.radius, 1) && !!sp.damage);
  const radius = spell && atLevel(spell.radius, 1);
  if (!spell || !radius || !spell.delay) return undefined;
  const lands = (spell.castPoint ?? 0) + spell.delay;
  const walk = r(me.stats.moveSpeed * lands);
  const leave = radius / me.stats.moveSpeed;
  if (walk < radius) return undefined;
  const from = firstLevelOf(data, enemy.id, enemyPosition, spell.key);
  return {
    rule: "dodge",
    tag: "Dodge",
    title: `Keep Moving While ${spell.name} Is Up`,
    parts: [
      { text: `${spell.name} lands ${s(lands)} s after the cast starts and reaches ${radius} from its center. ` },
      { text: "Keep moving", strong: true },
      { text: `: you cover ${walk} in that time${from ? `. High-rank ${enemy.name} players take it at level ${from}` : ""}.` },
    ],
    spells: [spell.key],
    visual: {
      kind: "timing",
      rows: [
        { spell: spell.key, seconds: lands, kind: "busy", label: `Lands in ${s(lands)} s` },
        { hero: me.id, seconds: leave, kind: "open", label: `You leave the circle in ${s(leave)} s` },
      ],
    },
    weight: (spellHit(enemy, spell, me.stats) * 0.8) / me.stats.health,
  };
}

function trading(me: Side, enemy: Side): LaneTactic | undefined {
  const ranged = casts(spellsOf(enemy)).filter((sp) => (atLevel(sp.castRange, 1) ?? sp.length ?? 0) >= RANGED_SPELL);
  const nuke = [...ranged].sort((a, b) => spellHit(enemy, b, me.stats) - spellHit(enemy, a, me.stats))[0];
  const cooldown = nuke && valueOf(enemy, nuke, nuke.cooldown);
  const hit = nuke && spellHit(enemy, nuke, me.stats);
  if (!nuke || !cooldown || !hit || cooldown < MIN_WINDOW_SECONDS || hit < me.stats.health * MIN_WINDOW_SHARE) return undefined;
  const others = ranged.filter((sp) => sp !== nuke);
  const next = others.map((sp) => ({ sp, cd: valueOf(enemy, sp, sp.cooldown) ?? 0 })).sort((a, b) => b.cd - a.cd)[0];
  return {
    rule: "window",
    tag: "Trade Window",
    title: `Hit ${enemy.name} After ${nuke.name}`,
    parts: [
      { text: `${nuke.name} deals ${r(hit)} of your ${r(me.stats.health)} HP from ${atLevel(nuke.castRange, 1) ?? nuke.length}. ${next ? `After it the only other reach is ${next.sp.name} on a ${s(next.cd)} s cooldown, so ` : "Once it is used, "}` },
      { text: `trade hits for ${s(cooldown)} s`, strong: true },
      { text: ` until ${nuke.name} is back.` },
    ],
    spells: [nuke.key, ...(next ? [next.sp.key] : [])],
    visual: {
      kind: "timing",
      rows: [
        { spell: nuke.key, seconds: cooldown, kind: "open", label: `${s(cooldown)} s to trade` },
        ...(next ? [{ spell: next.sp.key, seconds: next.cd, kind: "busy" as const, label: `${next.sp.name} ${s(next.cd)} s` }] : []),
      ],
    },
    weight: hit / me.stats.health,
  };
}

/** Average lane last hits from the lane results: [games, won, drawn, lost, last hits]. */
const lastHitsOf = (c: LaneCounts | undefined) => (c && c[0] >= MIN_LAST_HIT_LANES ? c[4] : undefined);

/** A hero's average lane last hits against every enemy, weighted by lanes. */
function usualLastHits(data: Snapshot, heroId: number): number | undefined {
  let games = 0;
  let sum = 0;
  for (const c of Object.values(data.laneOutcomes?.["0"]?.[String(heroId)] ?? {})) {
    if (c[4] === undefined) continue;
    games += c[0];
    sum += c[0] * c[4];
  }
  return games > 0 ? sum / games : undefined;
}

/** How many last hits high-rank players on this hero get in lane against this enemy, against their usual. */
function lastHits(data: Snapshot, me: Side, enemy: Side): LaneTactic | undefined {
  const target = lastHitsOf(data.laneOutcomes?.["0"]?.[String(me.id)]?.[String(enemy.id)]);
  const usual = usualLastHits(data, me.id);
  if (target === undefined || usual === undefined) return undefined;
  const theirs = lastHitsOf(data.laneOutcomes?.["0"]?.[String(enemy.id)]?.[String(me.id)]);
  const gap = r(target) - r(usual);
  const versus = gap === 0 ? "the same as" : `${Math.abs(gap)} ${gap > 0 ? "more" : "fewer"} than`;
  return {
    rule: "lastHits",
    tag: "Last Hits",
    title: `Last Hit Target: ${r(target)} by the End of Lane`,
    parts: [
      { text: `${me.name} players get ` },
      { text: `${r(target)} last hits in lane against ${enemy.name}`, strong: true },
      { text: `, ${versus} their usual ${r(usual)}.${theirs !== undefined ? ` ${enemy.name} gets ${r(theirs)} against you.` : ""}` },
    ],
    spells: [],
    visual: { kind: "lastHits", target: r(target), usual: r(usual), ...(theirs !== undefined ? { enemy: r(theirs) } : {}) },
    weight: 0,
  };
}

/** A side at a level, or undefined when the facts or the skill build are missing. */
function sideAt(data: Snapshot, id: number, position: Position, level: number, name: (id: number) => string): Side | undefined {
  const hero = laneHero(id);
  const levels = spellLevelsAt(data, id, position, level);
  return hero && levels ? { id, name: name(id), hero, stats: heroStatsAt(hero, level), levels } : undefined;
}

/**
 * Tactics for our hero against one enemy laner, most important first, at most MAX_TACTICS. Empty when the
 * facts or either hero's skill build are missing.
 */
export function laneTactics(data: Snapshot, ours: { id: number; position: Position }, enemy: { id: number; position: Position }, name: (id: number) => string): LaneTactic[] {
  const me3 = sideAt(data, ours.id, ours.position, EARLY_LEVEL, name);
  const enemy3 = sideAt(data, enemy.id, enemy.position, EARLY_LEVEL, name);
  const me6 = sideAt(data, ours.id, ours.position, ULT_LEVEL, name);
  const enemy6 = sideAt(data, enemy.id, enemy.position, ULT_LEVEL, name);
  if (!me3 || !enemy3 || !me6 || !enemy6) return [];
  const found = [
    killLine(me6, enemy6),
    yourSpell(me3, enemy3),
    trade(me3, enemy3),
    reach(me3, enemy3),
    auraEdge(me3, enemy3),
    split(me3, enemy3),
    lineUp(me3, enemy3),
    dodge(me3, enemy3, data, enemy.position),
    trading(me3, enemy3),
  ].filter((t): t is LaneTactic => !!t);
  // One tactic per rule, biggest stake first; two positioning rules about one spell say the same thing.
  const seen = new Set<string>();
  const ranked = found
    .sort((a, b) => b.weight - a.weight)
    .filter((t) => {
      const key = t.rule === "lineUp" || t.rule === "split" ? `pos:${t.spells[0]}` : t.rule;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // The last hit target always has a place, last: it is the lane's scoreboard, not a danger to rank.
  const target = lastHits(data, me3, enemy3);
  return target ? [...ranked.slice(0, MAX_TACTICS - 1), target] : ranked.slice(0, MAX_TACTICS);
}
