import { describe, expect, it } from "vitest";
import { POSITIONS_QUERY, toPositions } from "../src/data/stratz";
import { positionFit } from "../src/engine/positions";
import type { HeroInfo } from "../src/engine/types";

describe("STRATZ positions", () => {
  it("asks for each position once", () => {
    for (let p = 1; p <= 5; p++) expect(POSITIONS_QUERY).toContain(`pos${p}: winWeek(take: 1, positionIds: [POSITION_${p}])`);
  });

  it("adds up games per position for each hero", () => {
    const data = {
      pos1: [{ heroId: 1, matchCount: 900 }],
      pos2: [{ heroId: 1, matchCount: 100 }],
      pos4: [
        { heroId: 2, matchCount: 700 },
        { heroId: 2, matchCount: 50 },
      ],
      pos5: [{ heroId: 2, matchCount: 250 }],
    };
    expect(toPositions(data)).toEqual({ 1: [900, 100, 0, 0, 0], 2: [0, 0, 0, 750, 250] });
  });
});

describe("positionFit with STRATZ positions", () => {
  const riki: HeroInfo = { id: 32, name: "Riki", roles: ["Carry", "Escape"], attackType: "Melee", primaryAttr: "agi" };

  it("uses real positions over lane guesses", () => {
    const fit = positionFit(riki, { "2": 1000 }, [50, 100, 50, 700, 100]);
    expect(fit[4]).toBeCloseTo(0.7);
    expect(fit[2]).toBeCloseTo(0.1);
  });

  it("falls back to lanes when STRATZ has too few games", () => {
    const fit = positionFit(riki, { "2": 1000 }, [0, 0, 0, 10, 0]);
    expect(fit[2]).toBeGreaterThan(0.9);
  });
});
