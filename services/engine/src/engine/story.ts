/**
 * The Game Story: the game told in four timed chapters from our team's side, with a one-line
 * headline, built from the game plan's facts: the lane verdicts and their heroes, and our key
 * item minutes raced against theirs. Each chapter carries both teams' key items bought in its time
 * window (for the web timeline's item art), one short action, and the same as text for sharing.
 * Kept short on purpose: the team has about a minute to read it (see STORY_WORDS).
 */

import { listNames } from "./item-build";

/** When a team is strongest, from its style (see game-plan.ts). */
export type Timing = "early" | "late" | null;

/** A player's first big item and about when it is bought. */
export interface Spike {
  hero: string;
  item: string;
  minute: number;
  /** The minute comes from a build mixed over the hero's positions, so it is told as "around". */
  around?: boolean;
}

const atMinute = (s: Spike) => `${s.around ? "around" : "at"} ${s.minute}`;

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
  /** The real lane result behind the verdict, when the snapshot has lane results (see lane-odds.ts). */
  fact?: string;
}

/** One timed chapter: the items that land in it and what to do. */
export interface Chapter {
  phase: string;
  /** The chapter's minutes, `to` null for the last one ("30 min on"). */
  from: number;
  to: number | null;
  /** Our key items bought in this chapter, by minute. */
  ours: Spike[];
  /** Their key items bought in this chapter, their carry's first. */
  theirs: Spike[];
  /** The one thing to do, short, without the minutes the item art already shows. */
  action: string;
  /** The chapter as one sentence or three, for sharing as text. */
  text: string;
}

export interface Story {
  /** How we win and by when, in one short sentence. */
  headline: string;
  /** The minute our team is ready to fight (our second key item), if it comes. */
  ready?: number;
  chapters: Chapter[];
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
  if (f.ourTiming === "early") {
    const ready = nthMinute(f.spikes, READY_SPIKES);
    const theirs = carrySpike(f) ?? byMinute(f.theirSpikes ?? [])[0];
    if (ready !== undefined && theirs && ready + EVEN_MINUTES <= theirs.minute) {
      return `End early: ready at ${ready}, push before ${theirs.hero}'s ${theirs.item} ${atMinute(theirs)}.`;
    }
    return ready !== undefined ? `End early: ready at ${ready}, take towers before 30 minutes.` : "End early: take towers before 30 minutes.";
  }
  if (f.theirTiming === "early") return "Survive their early pushes: we are stronger after 25 minutes.";
  // No style claim: race our first two items against their carry's (or their first core's when they have
  // no carry), else the clearest measured lane.
  const ready = nthMinute(f.spikes, READY_SPIKES);
  const theirs = carrySpike(f) ?? byMinute(f.theirSpikes ?? [])[0];
  if (ready !== undefined && theirs) {
    if (ready + EVEN_MINUTES <= theirs.minute) return `Fight from ${ready} min, before ${theirs.hero} has ${theirs.item} ${atMinute(theirs)}.`;
    if (theirs.minute + EVEN_MINUTES <= ready) return `${theirs.hero} has ${theirs.item} ${atMinute(theirs)}: hold fights until ${ready} min.`;
  }
  const lane = [f.hardLane, f.wonLane].find((l) => l?.fact);
  if (lane) return lane === f.hardLane ? `Hard ${lane.name}: ${lane.fact}` : `Your ${lane.name} to press: ${lane.fact}`;
  if (ready !== undefined && theirs) return `Both teams are ready at ${ready} min: fight once your items are in, not before.`;
  return "Win the fights around your item timings.";
}

const itemAt = (s: Spike) => `${s.hero}'s ${s.item} ${atMinute(s)}`;

/**
 * Our cores' items in one window, one by name, or the two that make us ready in the ready window:
 * "Puck's Witch Blade at 12 and Magnus's Blink Dagger at 14: ready to fight at 14." Each item is told
 * in the window of its own minute.
 */
function ourSpikeText(inWindow: Spike[], ready: number | undefined, window: Timing): string {
  if (!inWindow.length) return "";
  const readyHere = ready !== undefined && inWindow.some((s) => s.minute === ready);
  // In the ready window, the two items that make us ready (never one after it); one item elsewhere.
  const named = (readyHere ? inWindow.filter((s) => s.minute <= ready).slice(-2) : inWindow.slice(0, 1))
    .map(itemAt)
    .join(" and ");
  // In their strongest time the items mean we can hold, not that we go.
  const go = window === "late" ? `fight back from ${ready}` : `ready to fight at ${ready}`;
  return readyHere ? `${named}: ${go}.` : `${named}.`;
}

/** "Their Phantom Assassin has Battle Fury at 17." for the first of their spikes in a window. */
function theirSpikeText(first: Spike | undefined): string {
  return first ? `Their ${first.hero} has ${first.item} ${atMinute(first)}.` : "";
}

/** "Juggernaut and Crystal Maiden" or "the safe lane". */
const who = (lane: LaneFact) => (lane.ours.length ? listNames(lane.ours) : `the ${lane.name}`);
const against = (lane: LaneFact) => (lane.theirs.length ? ` against ${listNames(lane.theirs)}` : "");

/**
 * What each lane does, from the lane verdicts: the won lane takes the tower, a hard off lane plays
 * for experience and a hard core lane for safe farm. A rotation plan would need to know where their supports go, which a draft can't.
 */
function laneText(f: StoryFacts): string {
  const verb = (lane: LaneFact, one: string, many: string) => (lane.ours.length === 1 ? one : many);
  const won = f.wonLane && `${who(f.wonLane)} ${verb(f.wonLane, "wins", "win")} the ${f.wonLane.name}${against(f.wonLane)}: take their tower.`;
  // An offlaner needs levels; a carry or mid in a hard lane still needs farm.
  const hard =
    f.hardLane &&
    (f.hardLane.name === "off lane"
      ? `Survive the off lane${against(f.hardLane)}: just get levels.`
      : `${f.hardLane.ours[0] ?? "Our core"} farms safely in the ${f.hardLane.name}${against(f.hardLane)}: skip trades.`);
  // The real lane result behind each verdict, so the reason can be checked.
  const facts = [f.wonLane?.fact, f.hardLane?.fact].filter(Boolean);
  return [won, hard, ...facts].filter(Boolean).join(" ") || "Every lane is even: the better last hits win.";
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

/** What to do in a chapter: the short line for the item art, the line for text, and the enemy spike it names. */
interface Action {
  short: string;
  long: string;
  names?: Spike;
}

const same = (line: string): Action => ({ short: line, long: line });

function action(chapter: number, f: StoryFacts, inWindow: (m: number) => boolean): Action {
  const window = ourWindow(f.ourTiming, f.theirTiming);
  const earlyIsOurs = window === "early";
  const lateIsOurs = window === "late";
  const theirs = carrySpike(f);
  const roshan = nthMinute(f.spikes, ROSHAN_SPIKES);
  switch (chapter) {
    case 0:
      return same(laneText(f));
    case 1:
      if (earlyIsOurs) {
        if (!theirs) return same("Group up and take towers.");
        // The item art shows the minute; the text names it once.
        const long = `Take towers before ${theirs.hero}'s ${theirs.item} ${atMinute(theirs)}.`;
        // In this chapter the item art shows their spike's minute; outside it the line keeps it.
        if (!inWindow(theirs.minute)) return same(long);
        return { short: `Take towers before their ${theirs.item}.`, long, names: theirs };
      }
      if (f.theirTiming === "early") return same(f.ourCarry ? `Their strongest time: defend towers together while ${f.ourCarry} farms.` : "Their strongest time: defend towers together.");
      return same(f.combo ? `Open fights with ${f.combo}.` : "");
    case 2:
      if (earlyIsOurs) return same("Take Roshan and end with the Aegis before 30 minutes.");
      // Not inside their strongest time (see the early headline).
      if (roshan !== undefined && roshan < 30) return same(`Roshan from ${Math.max(roshan, f.theirTiming === "early" ? 25 : 20)} min, once three key items are in.`);
      if (lateIsOurs) return same("Your items are in: take back the map.");
      return same("");
    default:
      if (lateIsOurs) return same("You are stronger now: take Roshan, then end with the Aegis.");
      if (f.theirTiming === "late") return same("They are stronger: fight only with buyback and a big opening spell.");
      // Nothing measured says how the late game goes for this draft, so the chapter is left out.
      return same("");
  }
}

export function gameStory(facts: StoryFacts): Story {
  const ready = nthMinute(facts.spikes, READY_SPIKES);
  const window = ourWindow(facts.ourTiming, facts.theirTiming);
  // Their carry's item first: it is the timing our fights race against. Then by minute.
  const isCarry = (s: Spike) => Number(s.hero === facts.enemyCarry);
  const carryFirst = [...(facts.theirSpikes ?? [])].sort((a, b) => isCarry(b) - isCarry(a) || a.minute - b.minute);
  const chapters = CHAPTERS.map((c, i): Chapter => {
    const inWindow = (m: number) => m >= c.from && m < c.to;
    // The lane chapter is about lanes: items under 10 min show on the player cards and danger list, not
    // here. A ready minute under 10 is still on the story for the timeline's mark.
    const isLane = i === 0;
    const ours = isLane ? [] : byMinute(facts.spikes).filter((s) => inWindow(s.minute));
    const theirs = isLane ? [] : carryFirst.filter((s) => inWindow(s.minute));
    const act = action(i, facts, inWindow);
    const theirLine = theirSpikeText(theirs.find((s) => s !== act.names));
    // After 30 the move matters more than one more item: the text keeps to the action (the art still shows them).
    const isLast = c.to === Infinity;
    const spikeLines = isLast ? [] : [ourSpikeText(ours, ready, window), theirLine];
    const text = [...spikeLines, act.long].filter(Boolean).join(" ");
    const to = Number.isFinite(c.to) ? c.to : null;
    return { phase: c.phase, from: c.from, to, ours, theirs, action: act.short, text };
  }).filter((c) => c.text);
  return { headline: headline(facts), ...(ready !== undefined ? { ready } : {}), chapters };
}

/** Words in a piece of text, as the word caps count them. */
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
