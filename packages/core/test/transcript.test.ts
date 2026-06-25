import { expect, test } from "bun:test";
import {
  shapeTranscript,
  toSrt,
  segmentTakes,
  wordsInRange,
  isDegenerate,
  type Transcript,
  type TranscriptWord,
} from "../src/transcript.ts";

test("shapeTranscript keeps the stable contract and tolerates missing fields", () => {
  const raw = {
    duration: 3.5,
    text: "hello world",
    words: [{ word: "hello", start: 0, end: 0.5 }],
    segments: [{ id: 0, start: 0, end: 1, text: "hello world" }],
  };
  const t = shapeTranscript(raw, "take.trec", "whisper-1");
  expect(t.source).toBe("take.trec");
  expect(t.model).toBe("whisper-1");
  expect(t.words).toEqual([{ word: "hello", start: 0, end: 0.5 }]);

  const empty = shapeTranscript({}, "x", "m");
  expect(empty.duration).toBeNull();
  expect(empty.words).toEqual([]);
});

test("toSrt renders 1-based, comma-millisecond, blank-line-separated cues", () => {
  const t: Transcript = {
    source: "x",
    model: "m",
    duration: null,
    text: "",
    words: [],
    segments: [
      { id: 0, start: 0, end: 1.5, text: "  Hello there  " },
      { id: 1, start: 1.5, end: 3661.25, text: "world" },
    ],
  };
  expect(toSrt(t)).toBe(
    "1\n00:00:00,000 --> 00:00:01,500\nHello there\n" +
      "\n" +
      "2\n00:00:01,500 --> 01:01:01,250\nworld\n" +
      "\n",
  );
});

const w = (word: string, start: number, end: number): TranscriptWord => ({ word, start, end });

test("segmentTakes splits on gaps larger than the threshold", () => {
  const words = [
    w("hello", 0, 0.5),
    w("world", 0.6, 1.1),
    // 2s gap
    w("second", 3.1, 3.6),
    w("take", 3.7, 4.0),
  ];
  const takes = segmentTakes(words, 1.2);
  expect(takes).toHaveLength(2);
  expect(takes[0].start).toBe(0);
  expect(takes[0].end).toBe(1.1);
  expect(takes[0].text).toBe("hello world");
  expect(takes[1].start).toBe(3.1);
  expect(takes[1].end).toBe(4.0);
  expect(takes[1].text).toBe("second take");
});

test("segmentTakes strips degenerate tail words before computing boundaries", () => {
  // A take where Whisper padded the end with 20 words all at the same stamp.
  const padding: TranscriptWord[] = Array.from({ length: 20 }, () => w("pad", 10.0, 10.0));
  const words = [
    w("real", 0, 0.5),
    w("speech", 0.6, 1.0),
    w("ends", 1.1, 1.4),
    // 3s gap then degenerate cluster
    ...padding,
  ];
  const takes = segmentTakes(words, 1.2);
  // The degenerate cluster forms its own "take" but is entirely stripped,
  // leaving only the real speech take.
  expect(takes).toHaveLength(1);
  expect(takes[0].start).toBe(0);
  expect(takes[0].end).toBe(1.4);
  expect(takes[0].text).toBe("real speech ends");
  expect(takes[0].words).toHaveLength(3);
});

test("segmentTakes strips degenerate words mixed into a take tail", () => {
  // Degenerate words at the end of a take (no gap separating them).
  const words = [
    w("audible", 5.0, 5.5),
    w("words", 5.6, 6.0),
    w("frozen1", 6.0, 6.0),
    w("frozen2", 6.0, 6.0),
  ];
  const takes = segmentTakes(words, 1.2);
  expect(takes).toHaveLength(1);
  expect(takes[0].end).toBe(6.0);
  expect(takes[0].words).toHaveLength(2);
  expect(takes[0].text).toBe("audible words");
});

test("segmentTakes drops takes that are entirely degenerate", () => {
  const words = [
    w("real", 0, 0.5),
    w("real2", 0.6, 1.0),
    // 5s gap then a pure degenerate cluster
    w("d1", 6.0, 6.0),
    w("d2", 6.0, 6.0),
  ];
  const takes = segmentTakes(words, 1.2);
  expect(takes).toHaveLength(1);
  expect(takes[0].text).toBe("real real2");
});

test("segmentTakes handles empty input", () => {
  expect(segmentTakes([])).toEqual([]);
});

test("isDegenerate detects zero-length and near-zero words", () => {
  expect(isDegenerate(w("x", 10, 10))).toBe(true);
  expect(isDegenerate(w("x", 10, 10.01))).toBe(true);
  expect(isDegenerate(w("x", 10, 10.06))).toBe(false);
  expect(isDegenerate(w("x", 10, 10.5))).toBe(false);
});

test("wordsInRange filters to the inclusive window and preserves indices", () => {
  const words = [
    w("zero", 0, 0.5),
    w("one", 0.6, 1.0),
    w("two", 1.1, 1.5),
    w("three", 1.6, 2.0),
    w("four", 2.1, 2.5),
  ];
  const result = wordsInRange(words, 0.6, 2.0);
  expect(result).toEqual([
    { idx: 1, word: "one", start: 0.6, end: 1.0 },
    { idx: 2, word: "two", start: 1.1, end: 1.5 },
    { idx: 3, word: "three", start: 1.6, end: 2.0 },
  ]);
});
