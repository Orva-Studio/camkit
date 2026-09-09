import { expect, test } from "bun:test";
import { planSeparateMedia, type ConvertedStream } from "../src/convert.ts";
import { planRebuild } from "../src/rebuild.ts";

export function fixture(): any {
  const timing = {
    start: 0,
    duration: 705600000,
    mediaStart: 0,
    mediaDuration: 705600000,
    scalar: 1,
  };
  return {
    version: "10.0",
    editRate: 705600000,
    videoFormatFrameRate: 30,
    width: 16,
    height: 16,
    sourceBin: [
      {
        id: 1,
        src: "recording.trec",
        sourceTracks: [
          {
            type: 0,
            range: [0, 1000],
            editRate: 1000,
            trackRect: [0, 0, 16, 16],
            sampleRate: 30,
          },
          {
            type: 2,
            range: [0, 16000],
            editRate: 16000,
            trackRect: [0, 0, 0, 0],
            sampleRate: 16000,
            numChannels: 1,
          },
        ],
      },
    ],
    timeline: {
      trackAttributes: [{ videoHidden: false }, { audioMuted: false }],
      sceneTrack: {
        scenes: [
          {
            csml: {
              tracks: [
                {
                  trackIndex: 0,
                  medias: [
                    {
                      id: 2,
                      _type: "ScreenVMFile",
                      src: 1,
                      trackNumber: 0,
                      ...timing,
                      parameters: {
                        scale0: {
                          type: "double",
                          defaultValue: 0.5,
                          interp: "eioe",
                        },
                        cursorScale: 2,
                      },
                      effects: [],
                    },
                  ],
                },
                {
                  trackIndex: 1,
                  medias: [
                    {
                      id: 3,
                      _type: "AMFile",
                      src: 1,
                      trackNumber: 1,
                      ...timing,
                      attributes: { gain: 0.7 },
                      parameters: {},
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
}
const streams: ConvertedStream[] = [
  {
    trackNumber: 0,
    file: "./media/stream-0.mp4",
    kind: "video",
    width: 16,
    height: 16,
  },
  {
    trackNumber: 1,
    file: "./media/stream-1.wav",
    kind: "audio",
    sampleRate: 16000,
    channels: 1,
  },
];
test("conversion preserves framing, gain and track flags with no TREC reference", () => {
  const d = fixture(),
    before = JSON.stringify(d);
  const p = planSeparateMedia(d, streams);
  expect(JSON.stringify(d)).toBe(before);
  expect(JSON.stringify(p.doc)).not.toContain(".trec");
  const ts = p.doc.timeline.sceneTrack.scenes[0].csml.tracks;
  expect(ts[0].medias[0].parameters.scale0.defaultValue).toBe(0.5);
  expect(ts[0].medias[0].parameters.cursorScale).toBeUndefined();
  expect(ts[1].medias[0].attributes.gain).toBe(0.7);
  expect(p.doc.timeline.trackAttributes).toEqual(d.timeline.trackAttributes);
  const r = planRebuild(
    p.doc,
    [{ src: p.syncGroups[0].sources[0].src, start: 0, end: 0.5 }],
    { syncGroups: p.syncGroups },
  );
  expect(r.newMedias[0][0].duration).toBe(r.newMedias[1][0].duration);
});
test("conversion refuses incomplete stream maps and trimmed timelines", () => {
  expect(() => planSeparateMedia(fixture(), streams.slice(0, 1))).toThrow(
    /Missing/,
  );
  const d = fixture();
  d.timeline.sceneTrack.scenes[0].csml.tracks[0].medias[0].mediaStart = 100;
  expect(() => planSeparateMedia(d, streams)).toThrow(/untrimmed/);
});
