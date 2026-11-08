import { describe, expect, it } from "vitest";
import { checkSourceUrl, defaultAllowedHosts } from "../src/core/sourceUrl";

const allowed = defaultAllowedHosts("https://abc.a5.environment.api.powerplatform.com/x?sig=1", "data.example.org");
const ok = (u: string) => checkSourceUrl(u, allowed).ok;

describe("checkSourceUrl", () => {
  it("accepts the organisers' links and configured hosts", () => {
    expect(ok("https://abc.a5.environment.api.powerplatform.com/powerautomate/x?sig=s&group_id=FBroker")).toBe(true);
    expect(ok("https://other.b2.environment.api.powerplatform.com/y")).toBe(true);
    expect(ok("https://data.example.org/set.json")).toBe(true);
  });

  it("refuses links that could reach internal services", () => {
    expect(ok("http://abc.a5.environment.api.powerplatform.com/x")).toBe(false);
    expect(ok("https://localhost:3000/api/dialogues")).toBe(false);
    expect(ok("https://127.0.0.1/x")).toBe(false);
    expect(ok("https://[::1]/x")).toBe(false);
    expect(ok("https://user:pw@data.example.org/x")).toBe(false);
    expect(ok("https://evil.example.com/x")).toBe(false);
    expect(ok("https://environment.api.powerplatform.com.evil.com/x")).toBe(false);
    expect(ok("not a url")).toBe(false);
  });
});
