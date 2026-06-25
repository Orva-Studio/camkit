/**
 * Transcript JSON contract (consumed by the take-picking / rebuild step;
 * multiply start/end by editRate at cut time). Produced from the OpenAI
 * whisper-1 verbose_json response — whisper-1 specifically, because the
 * gpt-4o-transcribe models don't return word-level timestamps.
 */

export interface TranscriptWord {
  word: string;
  start: number; // seconds
  end: number; // seconds
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  source: string;
  model: string;
  duration: number | null;
  text: string;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
}

/** SRT timestamp `HH:MM:SS,mmm` from a time in seconds. */
function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/**
 * Render a transcript's segments as SRT subtitles for Camtasia's caption
 * import (File ▸ Import ▸ Captions). Segment-level, not word-level — captions
 * read as phrases, and the rebuild step is the only consumer of word times.
 */
export function toSrt(transcript: Transcript): string {
  return (
    transcript.segments
      .map((seg, i) => `${i + 1}\n${srtTime(seg.start)} --> ${srtTime(seg.end)}\n${seg.text.trim()}\n`)
      .join("\n") + "\n"
  );
}

/** Shape a raw whisper verbose_json response into the stable contract. */
export function shapeTranscript(raw: any, source: string, model: string): Transcript {
  return {
    source,
    model,
    duration: raw.duration ?? null,
    text: raw.text ?? "",
    words: (raw.words ?? []).map((w: any) => ({ word: w.word, start: w.start, end: w.end })),
    segments: (raw.segments ?? []).map((s: any) => ({ id: s.id, start: s.start, end: s.end, text: s.text })),
  };
}

/** Minimum word duration (seconds) to count as real speech. Whisper pads
 * clip ends with degenerate zero-length words at a frozen timestamp; these
 * must be stripped before computing take boundaries or the reported start,
 * end, and word count are all wrong. */
export const DEGENERATE_THRESHOLD = 0.05;

/** Whether a word is degenerate (zero-length or near-zero). Whisper emits
 * these as padding at clip ends — a cluster of words all sharing the same
 * frozen timestamp (e.g. 20 words at 223.78). */
export function isDegenerate(w: TranscriptWord, threshold = DEGENERATE_THRESHOLD): boolean {
  return w.end - w.start < threshold;
}

export interface Take {
  start: number;
  end: number;
  words: TranscriptWord[];
  text: string;
}

/**
 * Segment a word list into takes by splitting on inter-word gaps larger than
 * `gap` seconds (default 1.2). Degenerate tail words (Whisper padding — zero-
 * length stamps at a frozen timestamp) are stripped from each take before
 * boundaries are computed, so the reported start/end/duration reflect audible
 * speech, not padding artifacts. Takes that are empty after stripping are
 * dropped entirely.
 */
export function segmentTakes(words: TranscriptWord[], gap = 1.2): Take[] {
  const takes: TranscriptWord[][] = [];
  let cur: TranscriptWord[] = [];

  for (const w of words) {
    if (cur.length > 0 && w.start - cur[cur.length - 1].end > gap) {
      takes.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length > 0) takes.push(cur);

  return takes
    .map((raw) => raw.filter((w) => !isDegenerate(w)))
    .filter((w) => w.length > 0)
    .map((words) => ({
      start: words[0].start,
      end: words[words.length - 1].end,
      words,
      text: words.map((w) => w.word).join(" "),
    }));
}

/**
 * Filter words that fall within [start, end] (inclusive on both ends).
 * Each result includes the original index in the source array so callers
 * can reference exact positions for cut-point decisions.
 */
export function wordsInRange(
  words: TranscriptWord[],
  start: number,
  end: number,
): { idx: number; word: string; start: number; end: number }[] {
  return words
    .map((w, idx) => ({ idx, word: w.word, start: w.start, end: w.end }))
    .filter((w) => w.start >= start && w.end <= end);
}
