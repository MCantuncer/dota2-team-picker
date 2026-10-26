import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

async function client() {
  return import("../src/data/opendota");
}

describe("getOpenDota", () => {
  it("returns the JSON and remembers how many requests are left today", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, [{ id: 1 }], { "x-rate-limit-remaining-day": "1234" })));
    const { getOpenDota, requestsLeftToday } = await client();
    expect(requestsLeftToday()).toBe(Infinity);
    expect(await getOpenDota("/heroStats")).toEqual([{ id: 1 }]);
    expect(requestsLeftToday()).toBe(1234);
  });

  it("retries a server error and gives up on a client error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(502, {})).mockResolvedValueOnce(reply(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { getOpenDota } = await client();
    const pending = getOpenDota("/matches/1");
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.stubGlobal("fetch", vi.fn(async () => reply(404, {})));
    const missing = getOpenDota("/matches/2");
    const check = expect(missing).rejects.toThrow("HTTP 404");
    await vi.runAllTimersAsync();
    await check;
  });

  it("waits as long as a 429 asks before trying again", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(429, {}, { "retry-after": "5" })).mockResolvedValueOnce(reply(200, 1));
    vi.stubGlobal("fetch", fetchMock);
    const { getOpenDota } = await client();
    const pending = getOpenDota("/publicMatches");
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe(1);
  });
});
