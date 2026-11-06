import { assertEquals } from "jsr:@std/assert@1";
import type { PlayerData } from "./opendota.ts";
import { profileUpdate } from "./sync.ts";

const player: PlayerData = {
  name: "ct'x",
  avatarUrl: "https://avatars.steamstatic.com/abc_full.jpg",
  rankTier: 54,
  heroStats: { "74": { games: 3, wins: 2 } },
  heroGames: [[74, 1, 1_700_000_000]],
};
const now = new Date("2026-11-06T20:00:00Z");

Deno.test("the site name and Steam name both follow the Steam persona", () => {
  const update = profileUpdate(player, now);
  assertEquals(update.display_name, "ct'x");
  assertEquals(update.steam_name, "ct'x");
  assertEquals(update.avatar_url, player.avatarUrl);
  assertEquals(update.synced_at, "2026-11-06T20:00:00.000Z");
  assertEquals(update.trends_checked_at, null);
});

Deno.test("a long Steam name is cut to what each column holds", () => {
  const update = profileUpdate({ ...player, name: "x".repeat(80) }, now);
  assertEquals(String(update.display_name).length, 40);
  assertEquals(String(update.steam_name).length, 64);
});

Deno.test("without a Steam name or picture the saved ones stay", () => {
  const update = profileUpdate({ ...player, name: null, avatarUrl: null }, now);
  assertEquals("display_name" in update, false);
  assertEquals("steam_name" in update, false);
  assertEquals("avatar_url" in update, false);
  assertEquals(update.rank_tier, 54);
});
