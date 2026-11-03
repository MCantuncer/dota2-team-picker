import { afterEach, describe, expect, it, vi } from "vitest";
import { postStratz } from "../src/data/stratz";

const answer = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("postStratz rate limits", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("waits and asks again after a 429", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(answer(429))
      .mockResolvedValueOnce(answer(429, {}, { "retry-after": "2" }))
      .mockResolvedValueOnce(answer(200, { data: { ok: true } }));
    vi.stubGlobal("fetch", fetch);
    const waits: number[] = [];
    const data = await postStratz("token", "{ ok }", "test", async (ms) => void waits.push(ms));
    expect(data).toEqual({ ok: true });
    expect(waits).toEqual([5000, 2000]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up after four tries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => answer(429)));
    const waits: number[] = [];
    await expect(postStratz("token", "{ ok }", "test", async (ms) => void waits.push(ms))).rejects.toThrow("STRATZ test failed: HTTP 429");
    expect(waits).toEqual([5000, 10000, 20000]);
  });

  it("does not retry other errors", async () => {
    const fetch = vi.fn().mockResolvedValue(answer(200, { errors: [{ message: "User is not an admin" }] }));
    vi.stubGlobal("fetch", fetch);
    await expect(postStratz("token", "{ ok }", "test", async () => {})).rejects.toThrow("User is not an admin");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
