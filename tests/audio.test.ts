import { describe, expect, it } from "vitest";
import { audioLinkExpiry, fetchAudioWithRefresh } from "../src/core/audio";

const NOW = Date.parse("2026-11-07T10:00:00Z");

describe("audioLinkExpiry", () => {
  it("reads the expiry from the signed link, with a safety margin", () => {
    expect(audioLinkExpiry("https://x.test/a.mp3?se=2026-11-07T11:00:00Z&sig=abc", NOW)).toBe(Date.parse("2026-11-07T10:59:00Z"));
  });

  it("treats a link without an expiry as short-lived", () => {
    expect(audioLinkExpiry("https://x.test/a.mp3?sig=abc", NOW)).toBe(NOW + 5 * 60_000);
    expect(audioLinkExpiry("not a url", NOW)).toBe(NOW + 5 * 60_000);
  });
});

describe("fetchAudioWithRefresh", () => {
  const stub = (statuses: number[]) => {
    const urls: string[] = [];
    const impl = (async (url: string) => {
      urls.push(url);
      return new Response(null, { status: statuses[urls.length - 1] });
    }) as unknown as typeof fetch;
    return { impl, urls };
  };
  const resolve = async (fresh: boolean) => (fresh ? "fresh-link" : "cached-link");

  it("uses the cached link while it works", async () => {
    const { impl, urls } = stub([206]);
    expect((await fetchAudioWithRefresh(resolve, {}, impl)).status).toBe(206);
    expect(urls).toEqual(["cached-link"]);
  });

  it("resolves a fresh link once when the cached one has expired", async () => {
    const { impl, urls } = stub([403, 206]);
    expect((await fetchAudioWithRefresh(resolve, {}, impl)).status).toBe(206);
    expect(urls).toEqual(["cached-link", "fresh-link"]);
  });

  it("does not retry a bad byte range", async () => {
    const { impl, urls } = stub([416]);
    expect((await fetchAudioWithRefresh(resolve, {}, impl)).status).toBe(416);
    expect(urls).toEqual(["cached-link"]);
  });
});
