import { describe, expect, test } from "bun:test";
import { filterSilences, parseRange, parseSilences } from "../src/silences.ts";

const STDERR = `
[silencedetect @ 0x600] silence_start: 12.4837
[silencedetect @ 0x600] silence_end: 13.9151 | silence_duration: 1.43137
[silencedetect @ 0x600] silence_start: 47.01
[silencedetect @ 0x600] silence_end: 47.62 | silence_duration: 0.61
size=N/A time=00:01:30.00 bitrate=N/A speed= 600x
`;

describe("parseSilences", () => {
  test("pairs start/end lines", () => {
    expect(parseSilences(STDERR)).toEqual([
      { start: 12.4837, end: 13.9151 },
      { start: 47.01, end: 47.62 },
    ]);
  });

  test("ignores a trailing unmatched start", () => {
    expect(parseSilences("silence_start: 5.0\n")).toEqual([]);
  });
});

describe("filterSilences", () => {
  test("keeps silences overlapping the range", () => {
    const sils = parseSilences(STDERR);
    expect(filterSilences(sils, 13, 20)).toEqual([{ start: 12.4837, end: 13.9151 }]);
    expect(filterSilences(sils, 0, 5)).toEqual([]);
  });
});

describe("parseRange", () => {
  test("parses a-b", () => {
    expect(parseRange("10.5-20")).toEqual([10.5, 20]);
  });
  test("rejects junk", () => {
    expect(() => parseRange("abc")).toThrow(/Bad --range/);
  });
});
