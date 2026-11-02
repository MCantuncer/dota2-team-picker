import { describe, expect, it } from "vitest";
import { STORY_WORDS, gameStory, wordCount, type StoryFacts, type Timing } from "../src/engine/story";

const facts = (over: Partial<StoryFacts> = {}): StoryFacts => ({ ourTiming: null, theirTiming: null, spikes: [], ...over });

describe("gameStory", () => {
  it("tells four chapters and names our item spikes in their window", () => {
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
    expect(story.chapters.map((c) => c.phase)).toEqual(["0 to 10 min", "10 to 20 min", "20 to 30 min", "30 min on"]);
    expect(story.chapters[0]!.text).toBe("Juggernaut and Crystal Maiden win the safe lane against Mars: take their tower. Survive the off lane against Axe and Witch Doctor: just get levels.");
    // Our first two items are one moment, then one more item; theirs is their carry's.
    expect(story.chapters[1]!.text).toBe(
      "Puck's Witch Blade at 12 and Magnus's Blink Dagger at 14: ready to fight at 14. Juggernaut's Battle Fury at 16. Their Phantom Assassin has Battle Fury at 17. Open fights with Reverse Polarity into Sven's God's Strength cleave.",
    );
    expect(story.chapters[2]!.text).toBe("Sven's Black King Bar at 24. Roshan from 20 min, once three key items are in.");
    expect(story.chapters[3]!.text).toBe("Fight when Phantom Assassin is dead or far from the fight.");
    // Our second item at 14 beats their carry's at 17.
    expect(story.headline).toBe("Fight from 14 min, before Phantom Assassin has Battle Fury at 17.");
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

  it("never calls us stronger late when both teams are late game teams", () => {
    const story = gameStory(facts({ ourTiming: "late", theirTiming: "late" }));
    expect(story.chapters.at(-1)!.text).toBe("They are stronger: fight only with buyback and a big opening spell.");
    expect(story.chapters.map((c) => c.phase)).toEqual(["0 to 10 min", "30 min on"]);
  });

  it("stays within its word caps in the worst case, for every pair of team timings", () => {
    const long = "Outworld Devourer";
    // One key item per player, two in each of the busiest chapters.
    const spikes = [8, 9, 14, 16, 22].map((minute) => ({ hero: "Keeper of the Light", item: "Aghanim's Scepter", minute }));
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
