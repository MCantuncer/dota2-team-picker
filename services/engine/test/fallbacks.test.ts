import { describe, expect, it } from "vitest";
import { keyItemLateLine } from "../src/engine/fallbacks";
import type { ItemInfo } from "../src/engine/types";

const item = (key: string, name: string): ItemInfo => ({ key, name, cost: 1000, img: `/items/${key}.png`, components: [] });
const ITEMS: Record<string, ItemInfo> = { 1: item("blink", "Blink Dagger"), 2: item("witch_blade", "Witch Blade") };
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

describe("keyItemLateLine", () => {
  it("answers a late key item with what late high-rank wins bought next", () => {
    expect(keyItemLateLine({ item: "Blink Dagger", late: 20, games: 48, steps: [[2, 18, 31], [1, 24, 20]] }, ITEMS)).toBe(
      "No Blink Dagger by 20 min? 31 of 48 high-rank wins without it bought Witch Blade next, around 18 min.",
    );
  });

  it("gives no line when nothing was measured", () => {
    expect(keyItemLateLine({ item: "Blink Dagger", late: 20, games: 48, steps: [] }, ITEMS)).toBeNull();
    // An item the snapshot can't name, or no item list at all.
    expect(keyItemLateLine({ item: "Blink Dagger", late: 20, games: 48, steps: [[99, 18, 31]] }, ITEMS)).toBeNull();
    expect(keyItemLateLine({ item: "Blink Dagger", late: 20, games: 48, steps: [[2, 18, 31]] }, undefined)).toBeNull();
    expect(keyItemLateLine({ item: "Blink Dagger", late: 20, games: 0, steps: [[2, 18, 31]] }, ITEMS)).toBeNull();
  });

  it("stays short enough for the game clock, even with long item names", () => {
    const long = { ...ITEMS, 3: item("ultimate_scepter", "Aghanim's Scepter"), 4: item("guardian_greaves", "Guardian Greaves") };
    const line = keyItemLateLine({ item: "Aghanim's Scepter", late: 28, games: 1200, steps: [[4, 26, 640]] }, long)!;
    expect(words(line)).toBeLessThanOrEqual(25);
    expect(line).not.toContain("\u2014");
  });
});
