import { describe, expect, it } from "vitest";
import { chooseDangerHeroes, dangerLine } from "../src/engine/danger";
import { STORY_WORDS, wordCount } from "../src/engine/story";

describe("chooseDangerHeroes", () => {
  it("names the biggest threat, then their carry, at most two", () => {
    expect(chooseDangerHeroes([67, 30, 31], 1)).toEqual([
      { id: 67, kind: "threat" },
      { id: 1, kind: "carry" },
    ]);
  });

  it("counts a carry who is also the biggest threat once, as a threat", () => {
    expect(chooseDangerHeroes([1, 30], 1)).toEqual([
      { id: 1, kind: "threat" },
      { id: 30, kind: "threat" },
    ]);
  });

  it("warns about their carry alone when nobody beats our team", () => {
    expect(chooseDangerHeroes([], 1)).toEqual([{ id: 1, kind: "carry" }]);
    expect(chooseDangerHeroes([], undefined)).toEqual([]);
  });
});

describe("dangerLine", () => {
  it("gives the item minute and the answer", () => {
    expect(dangerLine({ hero: "Faceless Void", kind: "carry", item: { name: "Black King Bar", minute: 21 }, isSure: true })).toBe(
      "Faceless Void: Black King Bar at 21 min. Take fights and towers before then.",
    );
  });

  it("says around when the enemy's position is a close guess", () => {
    expect(dangerLine({ hero: "Lion", kind: "threat", item: { name: "Blink Dagger", minute: 14 }, isSure: false })).toBe(
      "Lion: Blink Dagger around 14 min. Lock them down first in every fight.",
    );
  });

  it("still warns without item data", () => {
    expect(dangerLine({ hero: "Medusa", kind: "carry", isSure: false })).toBe("Medusa: farms fast. Take fights early.");
  });

  it("keeps two danger heroes with the longest names inside the word budget", () => {
    const lines = [
      dangerLine({ hero: "Outworld Devourer", kind: "threat", item: { name: "Aghanim's Scepter", minute: 25 }, isSure: false }),
      dangerLine({ hero: "Keeper of the Light", kind: "carry", item: { name: "Eye of Skadi", minute: 31 }, isSure: true }),
    ];
    expect(lines.reduce((n, l) => n + wordCount(l), 0)).toBeLessThanOrEqual(STORY_WORDS.danger);
  });
});
