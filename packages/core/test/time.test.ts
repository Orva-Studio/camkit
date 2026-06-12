import { describe, expect, test } from "bun:test";
import { secondsToFrameUnits, secondsToUnits, unitsToSeconds } from "../src/time.ts";

const ED = 705600000; // verified project-level editRate, Camtasia 2026.x

describe("secondsToUnits", () => {
  test("whole seconds", () => {
    expect(secondsToUnits(1, ED)).toBe(705600000);
    expect(secondsToUnits(10, ED)).toBe(7056000000);
  });

  test("fractional seconds round to nearest unit", () => {
    expect(secondsToUnits(0.5, ED)).toBe(352800000);
    expect(secondsToUnits(159.8, ED)).toBe(Math.round(159.8 * ED));
  });

  test("zero", () => {
    expect(secondsToUnits(0, ED)).toBe(0);
  });

  test("float-noise inputs stay integers", () => {
    // 46.3 is not exactly representable in binary; the result must still be
    // an integer unit count, not 46.3 * ED's raw float.
    const u = secondsToUnits(46.3, ED);
    expect(Number.isInteger(u)).toBe(true);
    expect(unitsToSeconds(u, ED)).toBeCloseTo(46.3, 6);
  });

  test("works with per-source editRates too", () => {
    expect(secondsToUnits(2, 44100)).toBe(88200);
  });
});

describe("secondsToFrameUnits", () => {
  const FRAME = ED / 30; // 23520000 units per frame at 30fps

  test("snaps to whole frame boundaries", () => {
    for (const s of [0.04, 18.2333, 46.3, 71.3167, 159.8]) {
      expect(secondsToFrameUnits(s, ED, 30) % FRAME).toBe(0);
    }
  });

  test("exact frame times are unchanged", () => {
    expect(secondsToFrameUnits(1, ED, 30)).toBe(ED);
    expect(secondsToFrameUnits(1 / 30, ED, 30)).toBe(FRAME);
  });

  test("rounds to the nearest frame", () => {
    // 0.0166 * 30 = 0.498 frames, rounds to 0; 0.017 * 30 = 0.51, rounds to 1.
    expect(secondsToFrameUnits(0.0166, ED, 30)).toBe(0);
    expect(secondsToFrameUnits(0.017, ED, 30)).toBe(FRAME);
  });

  test("returns integer units at fractional frame rates", () => {
    for (const s of [0.04, 18.2333, 28.45, 159.8]) {
      expect(Number.isInteger(secondsToFrameUnits(s, ED, 29.97))).toBe(true);
    }
  });

  test("snaps a real mid-frame transcript timestamp", () => {
    // 28.45s = 853.5 frames at 30fps; previously produced a half-frame offset.
    const u = secondsToFrameUnits(28.45, ED, 30);
    expect(u % FRAME).toBe(0);
    expect(u / FRAME).toBe(854);
  });
});

describe("unitsToSeconds", () => {
  test("round-trips", () => {
    for (const s of [0, 0.04, 1.5, 46.3, 159.8, 3600]) {
      expect(unitsToSeconds(secondsToUnits(s, ED), ED)).toBeCloseTo(s, 6);
    }
  });
});
