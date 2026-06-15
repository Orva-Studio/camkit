/**
 * Dynamic-caption preset resolution. Presets are NOT bundled — each lives in
 * Camtasia's user app-support dir as an effect.json that IS exactly the Callout
 * `def` block we inject. So camkit reads them on demand: list them, or resolve
 * a --preset name to its def. This is the one Camtasia-version-/user-specific
 * path; if it's missing we error clearly and let --preset-file override.
 *
 * Note `dynamic-caption-preset-ID` is NOT unique — a custom preset inherits the
 * base preset's ID (e.g. a copy of "Bebas 3 Line Word Red" still reports
 * blockPreset6). So the stable keys are the display name and the directory id;
 * preset-ID is only a fallback for the eight built-ins.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PRESETS_DIR = join(
  homedir(),
  "Library/Application Support/TechSmith/Camtasia/DynamicCaptions",
);

export interface PresetInfo {
  dir: string; // directory id (unique, e.g. "blockPreset6" or a UUID)
  presetId: string; // dynamic-caption-preset-ID (NOT unique across customs)
  name: string; // dynamic-caption-display-name
  def: any; // the effect.json — the Callout def, verbatim
}

/** Lowercase, non-alphanumerics → single hyphen; for matching names loosely. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Every preset found in the app-support dir (built-ins + user customs). */
export function listPresets(dir: string = PRESETS_DIR): PresetInfo[] {
  if (!existsSync(dir)) return [];
  const out: PresetInfo[] = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "effect.json");
    if (!existsSync(file)) continue;
    let def: any;
    try {
      def = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    out.push({
      dir: name,
      presetId: def["dynamic-caption-preset-ID"] ?? name,
      name: def["dynamic-caption-display-name"] ?? name,
      def,
    });
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * Resolve a --preset token to one preset. Matches (in order) directory id,
 * then display name (exact or slugified), then preset-ID. Throws on no match,
 * or on an ambiguous name/preset-ID with guidance to use the unique dir id.
 */
export function resolvePreset(token: string, dir: string = PRESETS_DIR): PresetInfo {
  const presets = listPresets(dir);
  if (!presets.length) {
    throw new Error(
      `No dynamic-caption presets found at ${dir}.\n` +
        `  Open Camtasia once (it populates them), or pass --preset-file PATH to an effect.json.`,
    );
  }
  const want = slug(token);
  const byDir = presets.filter((p) => p.dir === token);
  if (byDir.length === 1) return byDir[0];

  const byName = presets.filter((p) => slug(p.name) === want);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new Error(
      `"${token}" matches ${byName.length} presets by name. Use the unique id:\n` +
        byName.map((p) => `  --preset ${p.dir}   (${p.name})`).join("\n"),
    );
  }

  const byId = presets.filter((p) => slug(p.presetId) === want);
  if (byId.length === 1) return byId[0];

  throw new Error(
    `No preset matches "${token}". Available:\n` +
      presets.map((p) => `  ${p.dir.padEnd(38)} ${p.name}`).join("\n"),
  );
}
