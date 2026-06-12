/**
 * ffmpeg silencedetect output parsing. Essential cross-check: Whisper folds
 * pauses into a stretched neighboring word's timestamps, so transcripts alone
 * miss dead air — and Whisper word-time "gaps" can hide a clean retake that
 * silencedetect shows as continuous speech.
 */

export interface Silence {
  start: number; // seconds
  end: number; // seconds
}

/** Parse ffmpeg stderr lines for silence_start/silence_end pairs. */
export function parseSilences(ffmpegStderr: string): Silence[] {
  const out: Silence[] = [];
  let cur: number | null = null;
  for (const line of ffmpegStderr.split("\n")) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) cur = +s[1];
    if (e && cur != null) {
      out.push({ start: cur, end: +e[1] });
      cur = null;
    }
  }
  return out;
}

/** Keep silences overlapping [lo, hi] seconds. */
export function filterSilences(silences: Silence[], lo = 0, hi = Infinity): Silence[] {
  return silences.filter((s) => !(s.end < lo || s.start > hi));
}

/** Parse a "--range a-b" spec into [lo, hi] seconds. */
export function parseRange(range: string): [number, number] {
  const m = range.match(/^([\d.]+)-([\d.]+)$/);
  if (!m) throw new Error(`Bad --range "${range}" (want start-end seconds)`);
  return [+m[1], +m[2]];
}
