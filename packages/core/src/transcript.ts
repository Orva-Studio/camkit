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
