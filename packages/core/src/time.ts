/**
 * editRate time math. Camtasia projects use a project-level editRate
 * (705600000 units/second in observed 2026.x projects); all timeline clip
 * timing (start, duration, mediaStart, mediaDuration) is in project units,
 * including the nested video/audio blocks of a UnifiedMedia. Per-source
 * editRates (e.g. 44100) are NOT used for timeline edits.
 */

export function secondsToUnits(seconds: number, editRate: number): number {
  return Math.round(seconds * editRate);
}

/**
 * Convert seconds to project units snapped to the nearest whole video frame.
 * Camtasia's timeline ruler and playhead only move in whole frames, so cuts
 * made at sub-frame positions (e.g. millisecond transcript timestamps) appear
 * misaligned in the editor. fps comes from the doc's videoFormatFrameRate.
 */
export function secondsToFrameUnits(seconds: number, editRate: number, fps: number): number {
  const frame = editRate / fps;
  return Math.round((seconds * editRate) / frame) * frame;
}

export function unitsToSeconds(units: number, editRate: number): number {
  return units / editRate;
}
