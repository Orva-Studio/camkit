/**
 * Camtasia media-proxy cache helpers for `camkit prune-proxies`.
 *
 * Camtasia keeps `.ief` proxy transcodes in
 * ~/Library/Application Support/TechSmith/Camtasia/MediaProxies, one per
 * media file, keyed `<basename-without-extension>_<byte-size>.ief`
 * (e.g. outro.trec of 364787679 bytes → outro_364787679.ief). The cache is
 * never pruned by the app. Deleting an entry is safe for mp4/mov sources
 * (regenerated on demand) but re-exposes the .trec thumbnail deadlock
 * (issue #17) next time that project is opened, so pruning should keep the
 * proxies of any project still being edited.
 */
import { homedir } from "node:os";
import { basename, join } from "node:path";

export function mediaProxiesDir(): string {
  return join(homedir(), "Library", "Application Support", "TechSmith", "Camtasia", "MediaProxies");
}

/** Cache key Camtasia uses for a media file's proxy. */
export function proxyKey(mediaPath: string, byteSize: number): string {
  return `${basename(mediaPath).replace(/\.[^.]+$/, "")}_${byteSize}.ief`;
}

export interface ProxyEntry {
  name: string;
  size: number;
  mtimeMs: number;
}

export interface PrunePlan {
  remove: ProxyEntry[];
  keep: ProxyEntry[];
}

/** Split cache entries into remove/keep. `keepKeys` always survive; the rest
 * are removed unless younger than `olderThanDays`. */
export function planPrune(
  entries: ProxyEntry[],
  opts: { keepKeys?: Set<string>; olderThanDays?: number; now?: number } = {},
): PrunePlan {
  const now = opts.now ?? Date.now();
  const minAgeMs = (opts.olderThanDays ?? 0) * 24 * 60 * 60 * 1000;
  const plan: PrunePlan = { remove: [], keep: [] };
  for (const e of entries) {
    const protectedKey = opts.keepKeys?.has(e.name) ?? false;
    const oldEnough = now - e.mtimeMs >= minAgeMs;
    (protectedKey || !oldEnough ? plan.keep : plan.remove).push(e);
  }
  return plan;
}
