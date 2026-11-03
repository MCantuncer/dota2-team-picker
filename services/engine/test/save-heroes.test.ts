import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAVE_HEROES } from "../src/engine/traits";
import type { Snapshot } from "../src/engine/types";

describe("save heroes", () => {
  it("only names heroes that exist in the hero data", () => {
    const data = JSON.parse(readFileSync("data/snapshot.json", "utf8")) as Snapshot;
    const names = new Set(Object.values(data.heroes).map((h) => h.name));
    expect([...SAVE_HEROES].filter((n) => !names.has(n))).toEqual([]);
  });
});
