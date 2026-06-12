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
