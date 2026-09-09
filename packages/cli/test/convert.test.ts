import { expect, test } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { convertMedia } from "../src/convert.ts";

const available = !!Bun.which("ffmpeg") && !!Bun.which("ffprobe");
(available ? test : test.skip)(
  "conversion writes a validated new bundle and never overwrites input/output",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "camkit-convert-test-"));
    try {
      const timing = {
        start: 0,
        duration: 705600000,
        mediaStart: 0,
        mediaDuration: 705600000,
        scalar: 1,
      };
      const source = join(root, "project.tscproj"),
        out = join(root, "result.cmproj");
      const d = {
        editRate: 705600000,
        videoFormatFrameRate: 30,
        sourceBin: [
          {
            id: 1,
            src: "recording.trec",
            sourceTracks: [
              { type: 0, trackRect: [0, 0, 16, 16], sampleRate: 30 },
              {
                type: 2,
                trackRect: [0, 0, 0, 0],
                sampleRate: 16000,
                numChannels: 1,
              },
            ],
          },
        ],
        timeline: {
          sceneTrack: {
            scenes: [
              {
                csml: {
                  tracks: [
                    {
                      medias: [
                        {
                          id: 2,
                          _type: "ScreenVMFile",
                          src: 1,
                          trackNumber: 0,
                          ...timing,
                        },
                      ],
                    },
                    {
                      medias: [
                        {
                          id: 3,
                          _type: "AMFile",
                          src: 1,
                          trackNumber: 1,
                          ...timing,
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        },
      };
      const original = JSON.stringify(d);
      writeFileSync(source, original);
      const ff = spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=s=16x16:r=30:d=1",
          "-f",
          "lavfi",
          "-i",
          "sine=sample_rate=16000:duration=1",
          "-map",
          "0:v",
          "-map",
          "1:a",
          "-c:v",
          "libx264",
          "-c:a",
          "aac",
          "-f",
          "mp4",
          join(root, "recording.trec"),
        ],
        { encoding: "utf8" },
      );
      expect(ff.status).toBe(0);
      await convertMedia({ project: source, out, dryRun: true });
      expect(existsSync(out)).toBe(false);
      await expect(convertMedia({ project: source, out })).rejects.toThrow(
        /cursor/,
      );
      await convertMedia({ project: source, out, acknowledgeCursorLoss: true });
      expect(existsSync(join(out, "sync-groups.json"))).toBe(true);
      expect(readFileSync(source, "utf8")).toBe(original);
      await expect(
        convertMedia({ project: source, out, acknowledgeCursorLoss: true }),
      ).rejects.toThrow(/already exists/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30000,
);
