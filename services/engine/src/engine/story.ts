/**
 * The Game Story: the game told in four timed chapters from our team's side, with a one-line
 * headline, built from the game plan's facts: the lane verdicts and their heroes, and our key
 * item minutes raced against theirs. Each chapter names both teams' spikes in its time window, so
 * every player knows when the team is strong and when the enemy is. Kept short on purpose: the team has
 * about a minute to read it (see STORY_WORDS).
 */

import { listNames } from "./item-build";

/** When a team is strongest, from its style (see game-plan.ts). */
export type Timing = "early" | "late" | null;

/** A player's first big item and about when it is bought. */
export interface Spike {
  hero: string;
  item: string;
  minute: number;
}

export interface StoryFacts {
  ourTiming: Timing;
  theirTiming: Timing;
  /** The lane we win and the one that is hard, if any. */
  wonLane?: LaneFact;
  hardLane?: LaneFact;
  /** Our cores' key items (see game-plan.ts keyItem): the team is ready once two are in. */
  spikes: Spike[];
  /** The enemy cores' key items, from their usual builds. */
  theirSpikes?: Spike[];
  /** Our first combo, like "Reverse Polarity into Sven's God's Strength cleave". */
  combo?: string;
  ourCarry?: string;
  enemyCarry?: string;
}

/** A lane by its lowercase name ("safe lane", "mid") and its heroes on each side, by name. */
export interface LaneFact {
  name: string;
  ours: string[];
  theirs: string[];
}

export interface Story {
  /** How we win and by when, in one short sentence. */
  headline: string;
  chapters: { phase: string; text: string }[];
}

/**
 * Word caps, so the story stays a one-minute read with each player's card (Game Story plan).
 * The chapters name heroes, items and minutes now, so they get 100 words (about 30 seconds).
 */
export const STORY_WORDS = { headline: 15, chapters: 100, danger: 30 } as const;

const CHAPTERS = [
  { phase: "0 to 10 min", from: 0, to: 10 },
  { phase: "10 to 20 min", from: 10, to: 20 },
  { phase: "20 to 30 min", from: 20, to: 30 },
  { phase: "30 min on", from: 30, to: Infinity },
] as const;

/** Our team is ready to fight once this many of our key items are in. */
const READY_SPIKES = 2;
/** ...and ready for Roshan once this many are. */
const ROSHAN_SPIKES = 3;

/** Item timings this close count as the same time. */
const EVEN_MINUTES = 2;

/** The minute the `n`th of these spikes comes in, if it does. */
const byMinute = (spikes: Spike[]) => [...spikes].sort((a, b) => a.minute - b.minute);
const nthMinute = (spikes: Spike[], n: number) => byMinute(spikes)[n - 1]?.minute;

/** Their carry's key item, the timing our fights race against. */
const carrySpike = (f: StoryFacts) => f.theirSpikes?.find((s) => s.hero === f.enemyCarry);

function headline(f: StoryFacts): string {
  if (f.theirTiming === "late" && f.ourTiming !== "late") {
    return f.enemyCarry ? `Win before 30 minutes: their ${f.enemyCarry} outscales us.` : "Win before 30 minutes: they outscale us.";
  }
  if (f.ourTiming === "late" && f.theirTiming !== "late") {
    return f.ourCarry ? `Survive to 30 minutes: our ${f.ourCarry} outscales them.` : "Survive to 30 minutes: we outscale them.";
  }
  if (f.ourTiming === "early") return "End early: take towers before their carries are ready.";
  if (f.theirTiming === "early") return "Survive their early pushes: we are stronger after 25 minutes.";
  // No clear style: race our first two items against their carry's.
  const ready = nthMinute(f.spikes, READY_SPIKES);
  const theirs = carrySpike(f);
  if (ready !== undefined && theirs) {
    if (ready + EVEN_MINUTES <= theirs.minute) return `Fight from ${ready} min, before ${theirs.hero} has ${theirs.item} at ${theirs.minute}.`;
    if (theirs.minute + EVEN_MINUTES <= ready) return `${theirs.hero} has ${theirs.item} at ${theirs.minute}: hold fights until ${ready} min.`;
    return `Both teams are ready at ${ready} min: fight once your items are in, not before.`;
  }
  return "Win the fights around your item timings.";
}

const itemAt = (s: Spike) => `${s.hero}'s ${s.item} at ${s.minute}`;

/**
 * Our cores' items in one window, told as one moment: "Juggernaut's Battle Fury at 14 and Mars's
 * Blink Dagger at 15: ready to fight at 15." in the window of the second item, then one later item
 * per window ("Juggernaut's Black King Bar at 24.").
 */
function ourSpikeText(spikes: Spike[], from: number, to: number): string {
  const sorted = byMinute(spikes);
  const ready = sorted[READY_SPIKES - 1]?.minute;
  const inWindow = (m: number) => m >= from && m < to;
  // Before the ready moment the items wait for it; a single core's item still shows.
  const later = ready === undefined ? sorted : sorted.slice(READY_SPIKES);
  const next = later.find((s) => inWindow(s.minute));
  const readyText =
    ready !== undefined && inWindow(ready) ? `${sorted.slice(0, READY_SPIKES).map(itemAt).join(" and ")}: ready to fight at ${ready}.` : "";
  return [readyText, next ? `${itemAt(next)}.` : ""].filter(Boolean).join(" ");
}

/** "Their Phantom Assassin has Battle Fury at 17." for the first of their spikes in a window. */
function theirSpikeText(spikes: Spike[], from: number, to: number): string {
  const first = spikes.find((s) => s.minute >= from && s.minute < to);
  return first ? `Their ${first.hero} has ${first.item} at ${first.minute}.` : "";
}

/** "Juggernaut and Crystal Maiden" or "the safe lane". */
const who = (lane: LaneFact) => (lane.ours.length ? listNames(lane.ours) : `the ${lane.name}`);
const against = (lane: LaneFact) => (lane.theirs.length ? ` against ${listNames(lane.theirs)}` : "");

/**
 * What each lane does, from the lane verdicts: the won lane takes the tower, the hard lane plays
 * for experience. A rotation plan would need to know where their supports go, which a draft can't.
 */
function laneText(f: StoryFacts): string {
  const verb = (lane: LaneFact, one: string, many: string) => (lane.ours.length === 1 ? one : many);
  const won = f.wonLane && `${who(f.wonLane)} ${verb(f.wonLane, "wins", "win")} the ${f.wonLane.name}${against(f.wonLane)}: take their tower.`;
  const hard = f.hardLane && `Survive the ${f.hardLane.name}${against(f.hardLane)}: just get levels.`;
  return [won, hard].filter(Boolean).join(" ") || "Every lane is even: the better last hits win.";
}

/**
 * When the game is ours to win: "early" (we want it over before 30 minutes), "late" (we want it
 * long) or null. The one decision behind the headline, the chapters, the carry's job and the team
 * fallbacks, so they never disagree.
 */
export function ourWindow(ourTiming: Timing, theirTiming: Timing): Timing {
  // Who is stronger early and who late; when both teams want the same, neither side counts.
  if ((ourTiming === "early" || theirTiming === "late") && ourTiming !== "late") return "early";
  if ((ourTiming === "late" || theirTiming === "early") && theirTiming !== "late") return "late";
  return null;
}

function action(chapter: number, f: StoryFacts): string {
  const window = ourWindow(f.ourTiming, f.theirTiming);
  const earlyIsOurs = window === "early";
  const lateIsOurs = window === "late";
  const theirs = carrySpike(f);
  const roshan = nthMinute(f.spikes, ROSHAN_SPIKES);
  switch (chapter) {
    case 0:
      return laneText(f);
    case 1:
      if (earlyIsOurs) return theirs ? `Take towers before ${theirs.hero}'s ${theirs.item} at ${theirs.minute}.` : "Group up and take towers before their carries are ready.";
      if (f.theirTiming === "early") return f.ourCarry ? `Their strongest time: defend towers together while ${f.ourCarry} farms.` : "Their strongest time: defend towers together.";
      return f.combo ? `Open fights with ${f.combo}.` : "";
    case 2:
      if (earlyIsOurs) return "Take Roshan and end with the Aegis before 30 minutes.";
      // Not inside their strongest time (see the early headline).
      if (roshan !== undefined && roshan < 30) return `Roshan from ${Math.max(roshan, f.theirTiming === "early" ? 25 : 20)} min, once three key items are in.`;
      if (lateIsOurs) return "Your items are in: take back the map.";
      return "";
    default:
      if (lateIsOurs) return "You are stronger now: take Roshan, then end with the Aegis.";
      if (f.theirTiming === "late") return "They are stronger: fight only with buyback and a big opening spell.";
      return f.enemyCarry ? `Fight when ${f.enemyCarry} is dead or far from the fight.` : "";
  }
}

export function gameStory(facts: StoryFacts): Story {
  return {
    headline: headline(facts),
    chapters: CHAPTERS.map((c, i) => {
      // Their carry's item first: it is the timing our fights race against.
      const carryFirst = [...(facts.theirSpikes ?? [])].sort((a, b) => Number(b.hero === facts.enemyCarry) - Number(a.hero === facts.enemyCarry));
      // The lane chapter is about lanes: items under 10 min show on the player cards and danger list.
      const isLane = i === 0;
      return {
        phase: c.phase,
        text: [
          isLane ? "" : ourSpikeText(facts.spikes, c.from, c.to),
          isLane ? "" : theirSpikeText(carryFirst, c.from, c.to),
          action(i, facts),
        ]
          .filter(Boolean)
          .join(" "),
      };
    }).filter((c) => c.text),
  };
}

/** Words in a piece of text, as the word caps count them. */
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
