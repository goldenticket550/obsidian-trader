import { describe, it, expect } from "vitest";
import {
  candleStaleness,
  candleAgeLabel,
  describeFeed,
  formatEasternTime,
  formatEasternDateTime,
  formatEventTime,
  latestCandleLabel,
  scannedLabel,
  DATA_QUALITY_LABEL,
} from "@/lib/market-data/freshness";

describe("formatEasternTime", () => {
  it("renders a UTC instant in Eastern time with an explicit ET suffix", () => {
    // 17:35 UTC on a July date = 1:35 PM EDT.
    expect(formatEasternTime("2026-07-27T17:35:00Z")).toBe("1:35 PM ET");
  });

  it("uses EST rather than EDT in winter", () => {
    // 17:35 UTC in January = 12:35 PM EST.
    expect(formatEasternTime("2026-01-15T17:35:00Z")).toBe("12:35 PM ET");
  });

  it("says Unavailable for an unparseable timestamp instead of NaN", () => {
    expect(formatEasternTime("not-a-date")).toBe("Unavailable");
  });
});

describe("formatEasternDateTime", () => {
  it("includes the weekday so a Friday close viewed on Saturday is obvious", () => {
    const out = formatEasternDateTime("2026-07-24T20:00:00Z");
    expect(out).toMatch(/^Fri, Jul 24/);
    expect(out).toMatch(/ET$/);
  });

  it("says Unavailable for an unparseable timestamp", () => {
    expect(formatEasternDateTime("nope")).toBe("Unavailable");
  });
});

describe("candleStaleness", () => {
  const now = Date.parse("2026-07-27T18:00:00Z");

  it("treats a candle from within the last 15 minutes as current", () => {
    expect(candleStaleness("2026-07-27T17:50:00Z", now)).toBe("current");
  });

  it("treats a candle under an hour old as recent", () => {
    expect(candleStaleness("2026-07-27T17:20:00Z", now)).toBe("recent");
  });

  it("treats anything older than an hour as stale", () => {
    expect(candleStaleness("2026-07-27T14:00:00Z", now)).toBe("stale");
  });

  it("reports unavailable for null, undefined, or garbage rather than guessing", () => {
    expect(candleStaleness(null, now)).toBe("unavailable");
    expect(candleStaleness(undefined, now)).toBe("unavailable");
    expect(candleStaleness("not-a-date", now)).toBe("unavailable");
  });
});

describe("honest freshness labels", () => {
  it("labels candle time and scan time with different words", () => {
    const candle = latestCandleLabel("2026-07-27T17:35:00Z");
    const scan = scannedLabel("2026-07-27T18:00:00Z");
    expect(candle).toBe("Latest candle: 1:35 PM ET");
    expect(scan).toBe("Scanned 2:00 PM ET");
    expect(candle).not.toBe(scan);
  });

  it("never claims a candle time when there is no candle", () => {
    expect(latestCandleLabel(null)).toBe("Latest candle: Unavailable");
    expect(latestCandleLabel(undefined)).toBe("Latest candle: Unavailable");
  });

  it("never uses the phrase 'data live' for any quality", () => {
    for (const label of Object.values(DATA_QUALITY_LABEL)) {
      expect(label.toLowerCase()).not.toContain("live");
    }
  });

  it("labels simulated data as simulated, never as real-time", () => {
    expect(DATA_QUALITY_LABEL.simulated).toBe("Simulated data");
    expect(DATA_QUALITY_LABEL.delayed).toBe("Delayed data");
    expect(DATA_QUALITY_LABEL.realtime).toBe("Real-time data");
  });
});

describe("candleAgeLabel", () => {
  const now = Date.parse("2026-07-25T06:18:00Z");

  it("reports minutes, hours, and days at the right scales", () => {
    expect(candleAgeLabel("2026-07-25T05:48:00Z", now)).toBe("30m old");
    expect(candleAgeLabel("2026-07-24T20:18:00Z", now)).toBe("10h old");
    expect(candleAgeLabel("2026-07-22T06:18:00Z", now)).toBe("3d old");
  });

  it("returns null rather than a fake age when there is no candle", () => {
    expect(candleAgeLabel(null, now)).toBeNull();
    expect(candleAgeLabel("garbage", now)).toBeNull();
  });
});

describe("formatEventTime — an event from another day must say so", () => {
  // The bug this exists to prevent, taken from the live dashboard: the
  // action queue rendered "8:31 PM ET" while the browser clock read
  // 9:14 AM. 8:31 PM had not happened yet that day, so the event was
  // necessarily older — but nothing on screen said which day.
  const nowEt914am = Date.parse("2026-07-27T13:14:00Z"); // Mon 9:14 AM ET

  it("prefixes the weekday for a previous-day event, and omits it for a same-day event", () => {
    const yesterdayEvening = "2026-07-25T00:31:00Z"; // Fri Jul 24, 8:31 PM ET
    const earlierToday = "2026-07-27T12:45:00Z"; // Mon Jul 27, 8:45 AM ET

    const older = formatEventTime(yesterdayEvening, nowEt914am);
    const today = formatEventTime(earlierToday, nowEt914am);

    expect(older).toBe("Fri 8:31 PM ET");
    expect(today).toBe("8:45 AM ET");

    // The distinguishing property: one carries a day, the other doesn't.
    expect(older).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
    expect(today).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
  });

  it("treats an event from earlier the same ET day as today, not as older", () => {
    // 4:05 AM ET the same morning — same calendar day, so time-only.
    expect(formatEventTime("2026-07-27T08:05:00Z", nowEt914am)).toBe("4:05 AM ET");
  });

  it("treats an event just after ET midnight as a different day", () => {
    // 11:50 PM ET Sunday is a different Eastern date from Monday morning,
    // even though it is under 10 hours earlier.
    expect(formatEventTime("2026-07-27T03:50:00Z", nowEt914am)).toBe("Sun 11:50 PM ET");
  });

  it("adds the month and day once a weekday alone would be ambiguous", () => {
    // Three weeks back: "Fri" repeats every seven days, so weekday alone
    // is no better than no date at all.
    const threeWeeksAgo = "2026-07-04T00:31:00Z"; // Fri Jul 3, 8:31 PM ET
    expect(formatEventTime(threeWeeksAgo, nowEt914am)).toBe("Fri Jul 3, 8:31 PM ET");
  });

  it("says Unavailable rather than NaN for an unparseable timestamp", () => {
    expect(formatEventTime("not-a-date", nowEt914am)).toBe("Unavailable");
  });
});

describe("formatEasternTime — raw ISO must never reach the screen", () => {
  it("formats the exact ISO string the alert engine embeds in messages", () => {
    // Regression: the action queue fell back to the raw timestamp lifted
    // out of "[market data as of 2026-07-24T20:55:00.000Z]" and rendered
    // it verbatim next to properly formatted siblings.
    const embedded = "2026-07-24T20:55:00.000Z";
    const out = formatEasternTime(embedded);
    expect(out).toBe("4:55 PM ET");
    // No ISO-8601 shape survives into the rendered string. (Checking for
    // a bare "T" would false-positive on the "ET" suffix.)
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(out).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe("describeFeed", () => {
  // Regression test for a real defect seen on the live dashboard: a green
  // "Real-time data" badge at 2:18 AM ET on a Saturday, sitting above a
  // candle from Friday 3:55 PM. The feed was real-time; the data was not.
  const saturdayEarlyAm = Date.parse("2026-07-25T06:18:00Z"); // 2:18 AM ET
  const fridayClose = "2026-07-24T19:55:00Z"; // 3:55 PM ET Friday

  it("does not claim plain 'Real-time data' over a ten-hour-old candle", () => {
    const status = describeFeed("realtime", fridayClose, saturdayEarlyAm);
    expect(status.label).not.toBe("Real-time data");
    expect(status.label).toMatch(/10h old/);
    expect(status.staleness).toBe("stale");
  });

  it("still credits the feed as real-time while qualifying the data age", () => {
    const status = describeFeed("realtime", fridayClose, saturdayEarlyAm);
    expect(status.label).toMatch(/Real-time feed/);
  });

  it("uses the plain quality label when the data really is current", () => {
    const status = describeFeed("realtime", "2026-07-25T06:10:00Z", saturdayEarlyAm);
    expect(status.label).toBe("Real-time data");
    expect(status.staleness).toBe("current");
  });

  it("reports no candle rather than implying freshness", () => {
    const status = describeFeed("realtime", null, saturdayEarlyAm);
    expect(status.label).toMatch(/no candle/);
    expect(status.staleness).toBe("unavailable");
  });

  it("reports unavailable when there is no quality at all", () => {
    expect(describeFeed(null, null, saturdayEarlyAm).staleness).toBe("unavailable");
  });

  it("never labels simulated data as real-time, stale or not", () => {
    const status = describeFeed("simulated", fridayClose, saturdayEarlyAm);
    expect(status.label.toLowerCase()).not.toContain("real-time");
  });
});
