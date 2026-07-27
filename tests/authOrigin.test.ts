import { describe, it, expect } from "vitest";
import {
  resolveSiteOrigin,
  safeNextPath,
  isAcceptableOrigin,
  browserAuthOrigin,
} from "@/lib/auth/origin";

describe("resolveSiteOrigin", () => {
  it("uses the localhost request origin in development", () => {
    expect(
      resolveSiteOrigin({ requestOrigin: "http://localhost:3000", isProduction: false })
    ).toBe("http://localhost:3000");
  });

  it("prefers a configured NEXT_PUBLIC_SITE_URL over everything else", () => {
    expect(
      resolveSiteOrigin({
        siteUrl: "https://obsidian-trader.example.com",
        requestOrigin: "https://preview-abc.vercel.app",
        vercelProductionUrl: "obsidian-trader.vercel.app",
        isProduction: true,
      })
    ).toBe("https://obsidian-trader.example.com");
  });

  it("uses the HTTPS request origin when no site URL is configured", () => {
    expect(
      resolveSiteOrigin({ requestOrigin: "https://preview-abc.vercel.app", isProduction: true })
    ).toBe("https://preview-abc.vercel.app");
  });

  it("converts a bare Vercel production host into an https origin", () => {
    expect(
      resolveSiteOrigin({ vercelProductionUrl: "obsidian-trader.vercel.app", isProduction: true })
    ).toBe("https://obsidian-trader.vercel.app");
  });

  it("NEVER falls back to localhost in production — it throws instead", () => {
    expect(() =>
      resolveSiteOrigin({ requestOrigin: "http://localhost:3000", isProduction: true })
    ).toThrow();
  });

  it("ignores a malformed site URL and falls through to the next source", () => {
    expect(
      resolveSiteOrigin({
        siteUrl: "not a url",
        requestOrigin: "https://real.example.com",
        isProduction: true,
      })
    ).toBe("https://real.example.com");
  });

  it("rejects a non-https configured site URL in production", () => {
    // http:// in production is unacceptable; it must fall through.
    expect(
      resolveSiteOrigin({
        siteUrl: "http://insecure.example.com",
        requestOrigin: "https://real.example.com",
        isProduction: true,
      })
    ).toBe("https://real.example.com");
  });

  it("falls back to localhost only in development when nothing is configured", () => {
    expect(resolveSiteOrigin({ isProduction: false })).toBe("http://localhost:3000");
  });
});

describe("isAcceptableOrigin", () => {
  it("accepts localhost in development", () => {
    expect(isAcceptableOrigin("http://localhost:3000", false)).toBe(true);
  });
  it("rejects localhost in production", () => {
    expect(isAcceptableOrigin("http://localhost:3000", true)).toBe(false);
  });
  it("rejects http (non-https) in production", () => {
    expect(isAcceptableOrigin("http://example.com", true)).toBe(false);
  });
  it("accepts https in production", () => {
    expect(isAcceptableOrigin("https://example.com", true)).toBe(true);
  });
  it("rejects null", () => {
    expect(isAcceptableOrigin(null, false)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("allows a safe same-origin relative path", () => {
    expect(safeNextPath("/settings")).toBe("/settings");
  });
  it("preserves query and hash on a relative path", () => {
    expect(safeNextPath("/journal?tab=open#top")).toBe("/journal?tab=open#top");
  });
  it("defaults to / when next is missing", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
  it("rejects an absolute external URL", () => {
    expect(safeNextPath("https://evil.com/steal")).toBe("/");
  });
  it("rejects a protocol-relative URL", () => {
    expect(safeNextPath("//evil.com")).toBe("/");
  });
  it("rejects backslash-smuggled paths", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath("/foo\\bar")).toBe("/");
  });
  it("rejects a bare non-slash value", () => {
    expect(safeNextPath("evil.com")).toBe("/");
  });
});

describe("browserAuthOrigin", () => {
  it("uses window origin on localhost dev", () => {
    expect(browserAuthOrigin(undefined, "http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("prefers the configured site URL when the browser is on production", () => {
    expect(
      browserAuthOrigin("https://obsidian-trader.example.com", "https://obsidian-trader.example.com")
    ).toBe("https://obsidian-trader.example.com");
  });
  it("never yields localhost when the browser is on an https production origin", () => {
    // Even with a stray env value, an https window origin must win over localhost.
    const origin = browserAuthOrigin(undefined, "https://obsidian-trader.vercel.app");
    expect(origin).toBe("https://obsidian-trader.vercel.app");
    expect(origin).not.toContain("localhost");
  });
});
