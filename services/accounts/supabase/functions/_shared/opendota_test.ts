import { assertEquals } from "jsr:@std/assert@1";
import { fetchPlayer } from "./opendota.ts";

function openDota(responses: Record<string, unknown>) {
  const requested: string[] = [];
  const fetchFn = ((url: string, init?: RequestInit) => {
    requested.push(`${init?.method ?? "GET"} ${url}`);
    const path = new URL(url).pathname.replace("/api", "");
    if (init?.method === "POST") return Promise.resolve(new Response("{}"));
    return Promise.resolve(
      path in responses ? Response.json(responses[path]) : new Response("not found", { status: 404 }),
    );
  }) as typeof fetch;
  return { fetchFn, requested };
}

Deno.test("reads rank, profile and hero record", async () => {
  const api = openDota({
    "/players/86745912": {
      profile: { personaname: "Can", avatarfull: "https://avatars.steamstatic.com/a_full.jpg" },
      rank_tier: 54,
    },
    "/players/86745912/heroes": [
      { hero_id: 53, games: 13, win: 10 },
      { hero_id: "19", games: 4, win: 2 },
      { hero_id: 1, games: 0, win: 0 },
    ],
  });
  const player = await fetchPlayer(86745912, api.fetchFn);
  assertEquals(player, {
    name: "Can",
    avatarUrl: "https://avatars.steamstatic.com/a_full.jpg",
    rankTier: 54,
    heroStats: { "53": { games: 13, wins: 10 }, "19": { games: 4, wins: 2 } },
  });
  assertEquals(api.requested[0], "POST https://api.opendota.com/api/players/86745912/refresh");
});

Deno.test("hidden profiles have no rank", async () => {
  const api = openDota({
    "/players/1": { profile: null, rank_tier: null },
    "/players/1/heroes": [],
  });
  assertEquals(await fetchPlayer(1, api.fetchFn), { name: null, avatarUrl: null, rankTier: null, heroStats: {} });
});
