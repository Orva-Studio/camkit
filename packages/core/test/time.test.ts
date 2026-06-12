import { describe, expect, test } from "bun:test";
import { secondsToUnits, unitsToSeconds } from "../src/time.ts";

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

describe("unitsToSeconds", () => {
  test("round-trips", () => {
    for (const s of [0, 0.04, 1.5, 46.3, 159.8, 3600]) {
      expect(unitsToSeconds(secondsToUnits(s, ED), ED)).toBeCloseTo(s, 6);
    }
  });
});
