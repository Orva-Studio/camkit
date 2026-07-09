import { expect, test } from "bun:test";
import { capPerSource, warmStages } from "../src/camkit.ts";
import type { KeepSeg } from "@camkit/core";

function segs(src: number, count: number): KeepSeg[] {
  return Array.from({ length: count }, (_, i) => ({ src, start: i, end: i + 1 }));
}

test("warmStages: batch 2, one source, 5 segs -> 3 stages, last stage full", () => {
  const s = segs(1, 5);
  const stages = warmStages(s, 2);
  expect(stages.length).toBe(3);
  expect(stages.map((st) => st.length)).toEqual([2, 4, 5]);
  expect(stages.at(-1)).toEqual(s);
});

test("warmStages: interleaved two sources", () => {
  const s: KeepSeg[] = [
    { src: 1, start: 0, end: 1 },
    { src: 2, start: 0, end: 1 },
    { src: 1, start: 1, end: 2 },
    { src: 2, start: 1, end: 2 },
    { src: 1, start: 2, end: 3 },
  ];
  const stages = warmStages(s, 1);
  expect(stages.length).toBe(3);
  expect(stages[0]).toEqual([s[0], s[1]]);
  expect(stages[1]).toEqual([s[0], s[1], s[2], s[3]]);
  expect(stages.at(-1)).toEqual(s);
});

test("warmStages: batch larger than max count -> single stage", () => {
  const s = segs(1, 3);
  const stages = warmStages(s, 10);
  expect(stages.length).toBe(1);
  expect(stages[0]).toEqual(s);
});

test("capPerSource: caps each source independently, preserves order", () => {
  const s: KeepSeg[] = [
    { src: 1, start: 0, end: 1 },
    { src: 2, start: 0, end: 1 },
    { src: 1, start: 1, end: 2 },
    { src: 1, start: 2, end: 3 },
  ];
  expect(capPerSource(s, 2)).toEqual([s[0], s[1], s[2]]);
});
