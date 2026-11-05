import { describe, expect, it } from "vitest";
import { STORY_WORDS, gameStory, wordCount, type Chapter, type StoryFacts, type Timing } from "../src/engine/story";

const facts = (over: Partial<StoryFacts> = {}): StoryFacts => ({ ourTiming: null, theirTiming: null, spikes: [], ...over });

describe("gameStory", () => {
  it("tells the chapters it has facts for and names our item spikes in their window", () => {
    const story = gameStory(
      facts({
        wonLane: { name: "safe lane", ours: ["Juggernaut", "Crystal Maiden"], theirs: ["Mars"] },
        hardLane: { name: "off lane", ours: ["Magnus", "Lion"], theirs: ["Axe", "Witch Doctor"] },
        spikes: [
          { hero: "Magnus", item: "Blink Dagger", minute: 14 },
          { hero: "Juggernaut", item: "Battle Fury", minute: 16 },
          { hero: "Puck", item: "Witch Blade", minute: 12 },
          { hero: "Sven", item: "Black King Bar", minute: 24 },
        ],
        theirSpikes: [
          { hero: "Shadow Fiend", item: "Eul's Scepter of Divinity", minute: 11 },
          { hero: "Phantom Assassin", item: "Battle Fury", minute: 17 },
        ],
        combo: "Reverse Polarity into Sven's God's Strength cleave",
        enemyCarry: "Phantom Assassin",
      }),
    );
    // Nothing measured says how the late game goes, so there is no "30 min on" chapter.
    expect(story.chapters.map((c) => c.phase)).toEqual(["0 to 10 min", "10 to 20 min", "20 to 30 min"]);
    expect(story.chapters[0]!.text).toBe("Juggernaut and Crystal Maiden win the safe lane against Mars: take their tower. Survive the off lane against Axe and Witch Doctor: just get levels.");
    // Our first two items are one moment, and the only one in their chapter; theirs is their carry's.
    expect(story.chapters[1]!.text).toBe(
      "Puck's Witch Blade at 12 and Magnus's Blink Dagger at 14: ready to fight at 14. Their Phantom Assassin has Battle Fury at 17. Open fights with Reverse Polarity into Sven's God's Strength cleave.",
    );
    expect(story.chapters[2]!.text).toBe("Sven's Black King Bar at 24. Roshan from 20 min, once three key items are in.");
    // Our second item at 14 beats their carry's at 17.
    expect(story.headline).toBe("Fight from 14 min, before Phantom Assassin has Battle Fury at 17.");
  });

  it("leads with the measured lane when no item race is clear, the hard lane first", () => {
    const hard = { name: "off lane", ours: ["Sven"], theirs: ["Anti-Mage"], fact: "Sven wins 30% and loses 45% of 5,000 lanes against Anti-Mage." };
    const won = { name: "safe lane", ours: ["Medusa"], theirs: ["Lich"], fact: "Medusa wins 46% and loses 32% of 4,100 lanes against Lich." };
    const story = gameStory(facts({ hardLane: hard, wonLane: won }));
    expect(story.headline).toBe("Hard off lane: Sven wins 30% and loses 45% of 5,000 lanes against Anti-Mage.");
    // The lane chapter gives both results behind its verdicts.
    expect(story.chapters[0]!.text).toContain("Medusa wins 46% and loses 32% of 4,100 lanes against Lich. Sven wins 30%");
    expect(gameStory(facts({ wonLane: won })).headline).toBe("Your safe lane to press: Medusa wins 46% and loses 32% of 4,100 lanes against Lich.");
    // An item race still comes first.
    const race = gameStory(
      facts({
        hardLane: hard,
        spikes: [
          { hero: "Magnus", item: "Blink Dagger", minute: 13 },
          { hero: "Sven", item: "Black King Bar", minute: 14 },
        ],
        theirSpikes: [{ hero: "Anti-Mage", item: "Battle Fury", minute: 18 }],
        enemyCarry: "Anti-Mage",
      }),
    );
    expect(race.headline).toBe("Fight from 14 min, before Anti-Mage has Battle Fury at 18.");
  });

  it("puts each item in the chapter of its own minute and never names their spike twice", () => {
    // Can's game (2026-11-03): Eul's at 15 was told in the 20 to 30 chapter, and Radiance at 17 twice.
    const story = gameStory(
      facts({
        theirTiming: "late",
        spikes: [
          { hero: "Death Prophet", item: "Eul's Scepter of Divinity", minute: 15 },
          { hero: "Lina", item: "Yasha and Kaya", minute: 24 },
        ],
        theirSpikes: [
          { hero: "Wraith King", item: "Blink Dagger", minute: 21 },
          { hero: "Lifestealer", item: "Radiance", minute: 17 },
        ],
        enemyCarry: "Lifestealer",
      }),
    );
    expect(story.ready).toBe(24);
    // Lane, 10 to 20, 20 to 30 and 30 on: all four have something to say here.
    expect(story.chapters).toHaveLength(4);
    const [, mid, late] = story.chapters as [Chapter, Chapter, Chapter, Chapter];
    expect(mid.ours.map((s) => s.minute)).toEqual([15]);
    expect(mid.theirs.map((s) => s.item)).toEqual(["Radiance"]);
    // The chapter's item art shows Radiance at 17, so the short line drops the minute and the text says it once.
    expect(mid.action).toBe("Take towers before their Radiance.");
    expect(mid.text).toBe("Death Prophet's Eul's Scepter of Divinity at 15. Take towers before Lifestealer's Radiance at 17.");
    expect(late.ours.map((s) => s.minute)).toEqual([24]);
    expect(late.theirs.map((s) => s.item)).toEqual(["Blink Dagger"]);
    expect(late.action).toBe("Take Roshan and end with the Aegis before 30 minutes.");
    expect([mid.from, mid.to, story.chapters[3]?.to]).toEqual([10, 20, null]);
  });

  it("keeps their spike's minute in the short line when it lands in another chapter", () => {
    const story = gameStory(
      facts({ theirTiming: "late", theirSpikes: [{ hero: "Lifestealer", item: "Radiance", minute: 25 }], enemyCarry: "Lifestealer" }),
    );
    const mid = story.chapters.find((c) => c.phase === "10 to 20 min");
    expect(mid?.action).toBe("Take towers before Lifestealer's Radiance at 25.");
    expect(mid?.theirs).toEqual([]);
  });

  it("names the items that make us ready, never one after the ready minute", () => {
    const spikes = [15, 24, 26].map((minute, i) => ({ hero: `Hero ${i}`, item: `Item ${i}`, minute }));
    const late = gameStory(facts({ spikes })).chapters.find((c) => c.phase === "20 to 30 min");
    expect(late?.ours.map((s) => s.minute)).toEqual([24, 26]);
    // Item 0 at 15 is told in its own chapter; Item 2 at 26 comes after the ready minute.
    expect(late?.text).toBe("Hero 1's Item 1 at 24: ready to fight at 24. Roshan from 26 min, once three key items are in.");
  });

  it("leaves items under 10 minutes off the lane chapter", () => {
    const story = gameStory(facts({ spikes: [{ hero: "Lion", item: "Blink Dagger", minute: 8 }], theirSpikes: [{ hero: "Axe", item: "Blink Dagger", minute: 9 }] }));
    expect(story.chapters[0]?.ours).toEqual([]);
    expect(story.chapters[0]?.theirs).toEqual([]);
  });

  it("races our items against their carry's in the headline", () => {
    const spikes = [
      { hero: "Lion", item: "Blink Dagger", minute: 13 },
      { hero: "Juggernaut", item: "Battle Fury", minute: 15 },
    ];
    const race = (minute: number) =>
      gameStory(facts({ spikes, theirSpikes: [{ hero: "Spectre", item: "Radiance", minute }], enemyCarry: "Spectre" })).headline;
    expect(race(18)).toBe("Fight from 15 min, before Spectre has Radiance at 18.");
    expect(race(16)).toBe("Both teams are ready at 15 min: fight once your items are in, not before.");
    expect(race(12)).toBe("Spectre has Radiance at 12: hold fights until 15 min.");
    // Without their carry's item there is nothing to race.
    expect(gameStory(facts({ spikes })).headline).toBe("Win the fights around your item timings.");
  });

  it("tells each lane what to do from its verdict, never sending the mid on a template rotation", () => {
    expect(gameStory(facts({ hardLane: { name: "mid", ours: ["Puck"], theirs: ["Pudge"] } })).chapters[0]!.text).toBe(
      "Puck farms safely in the mid against Pudge: skip trades.",
    );
    expect(gameStory(facts()).chapters[0]!.text).toBe("Every lane is even: the better last hits win.");
  });

  it("plays early against a late game team, and late against an early one", () => {
    const early = gameStory(facts({ theirTiming: "late", enemyCarry: "Medusa" }));
    expect(early.headline).toBe("Win before 30 minutes: their Medusa outscales us.");
    expect(early.chapters[2]!.text).toBe("Take Roshan and end with the Aegis before 30 minutes.");
    expect(early.chapters[3]!.text).toBe("They are stronger: fight only with buyback and a big opening spell.");

    const late = gameStory(facts({ theirTiming: "early" }));
    expect(late.headline).toBe("Survive their early pushes: we are stronger after 25 minutes.");
    expect(late.chapters[1]!.text).toBe("Their strongest time: defend towers together.");
    // No Roshan inside their strongest time.
    const spikes = [12, 14, 21].map((minute) => ({ hero: "Lion", item: "Blink Dagger", minute }));
    expect(gameStory(facts({ theirTiming: "early", spikes })).chapters[2]!.text).toBe(
      "Lion's Blink Dagger at 21. Roshan from 25 min, once three key items are in.",
    );
    expect(late.chapters[3]!.text).toBe("You are stronger now: take Roshan, then end with the Aegis.");
  });

  it("ends an early game by our ready minute, and never names carries they don't have", () => {
    const spikes = [14, 15].map((minute) => ({ hero: "Ursa", item: "Battle Fury", minute }));
    const tide = [{ hero: "Tidehunter", item: "Blink Dagger", minute: 19 }];
    expect(gameStory(facts({ ourTiming: "early", spikes, theirSpikes: tide })).headline).toBe(
      "End early: ready at 15, push before Tidehunter's Blink Dagger at 19.",
    );
    expect(gameStory(facts({ ourTiming: "early", spikes })).headline).toBe("End early: ready at 15, take towers before 30 minutes.");
    expect(JSON.stringify(gameStory(facts({ ourTiming: "early" })))).not.toContain("carries");
  });

  it("holds in their strongest time, and says around for a rough enemy minute everywhere", () => {
    const spikes = [16, 17].map((minute) => ({ hero: "Medusa", item: "Manta Style", minute }));
    const spectre = [{ hero: "Spectre", item: "Radiance", minute: 18, around: true }];
    expect(gameStory(facts({ theirTiming: "early", spikes })).chapters[1]!.text).toMatch(/: fight back from 17\./);
    const story = gameStory(facts({ spikes, theirSpikes: spectre, enemyCarry: "Spectre" }));
    expect(story.headline).toBe("Both teams are ready at 17 min: fight once your items are in, not before.");
    expect(story.chapters[1]!.text).toContain("Their Spectre has Radiance around 18.");
  });

  it("never calls us stronger late when both teams are late game teams", () => {
    const story = gameStory(facts({ ourTiming: "late", theirTiming: "late" }));
    expect(story.chapters.at(-1)!.text).toBe("They are stronger: fight only with buyback and a big opening spell.");
    expect(story.chapters.map((c) => c.phase)).toEqual(["0 to 10 min", "30 min on"]);
  });

  it("stays within its word caps in the worst case, for every pair of team timings", () => {
    const long = "Outworld Devourer";
    // Key items in every chapter, the ready moment included, and two after 30.
    const spikes = [8, 9, 14, 16, 22, 24, 33, 36].map((minute) => ({ hero: "Keeper of the Light", item: "Aghanim's Scepter", minute }));
    const timings: Timing[] = ["early", "late", null];
    for (const ourTiming of timings) {
      for (const theirTiming of timings) {
        const story = gameStory({
          ourTiming,
          theirTiming,
          wonLane: { name: "safe lane", ours: [long, long], theirs: [long, long] },
          hardLane: { name: "off lane", ours: [long, long], theirs: [long, long] },
          spikes,
          theirSpikes: spikes,
          combo: "Reverse Polarity into Sven's God's Strength cleave",
          ourCarry: long,
          enemyCarry: long,
        });
        const label = `${ourTiming} vs ${theirTiming}`;
        expect(wordCount(story.headline), label).toBeLessThanOrEqual(STORY_WORDS.headline);
        expect(story.chapters.reduce((n, c) => n + wordCount(c.text), 0), label).toBeLessThanOrEqual(STORY_WORDS.chapters);
        for (const c of story.chapters) expect(c.text, label).not.toContain("\u2014");
      }
    }
  });
});
