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

export function unitsToSeconds(units: number, editRate: number): number {
  return units / editRate;
}
