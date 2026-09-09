/** Pure planning for converting one uncut recording to separate editable media. */
import { assertSimpleTimeline, setTiming, type SyncGroup } from "./rebuild.ts";
import { clipSrc, tracks } from "./project.ts";

export interface ConvertedStream {
  trackNumber: number;
  file: string;
  kind: "video" | "audio";
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
}
export function planSeparateMedia(doc: any, streams: ConvertedStream[]) {
  assertSimpleTimeline(doc);
  const ts = tracks(doc);
  const placed = ts.flatMap((t) => t.medias ?? []);
  const ids = new Set(placed.map(clipSrc));
  if (ids.size !== 1 || !placed.length)
    throw new Error(
      "convert-media requires a single uncut recording on the timeline.",
    );
  const sourceId = clipSrc(placed[0])!;
  const source = doc.sourceBin.find((s: any) => s.id === sourceId);
  if (!source || !/\.trec$/i.test(source.src))
    throw new Error("convert-media expects a TREC source.");
  const duration = placed[0].duration;
  if (
    !Number.isSafeInteger(duration) ||
    duration <= 0 ||
    !Number.isFinite(doc.editRate) ||
    doc.editRate <= 0 ||
    !Number.isFinite(doc.videoFormatFrameRate) ||
    doc.videoFormatFrameRate <= 0
  )
    throw new Error("Invalid recording timing.");
  const leaves: { clip: any; parent: any; track: any; trackIndex: number }[] =
    [];
  ts.forEach((track, trackIndex) => {
    if ((track.medias ?? []).length > 1)
      throw new Error("convert-media requires uncut tracks.");
    for (const parent of track.medias ?? []) {
      if (
        parent.start !== 0 ||
        parent.mediaStart !== 0 ||
        parent.duration !== duration ||
        parent.mediaDuration !== duration
      )
        throw new Error(
          "convert-media requires aligned, untrimmed clips starting at zero.",
        );
      if (
        parent._type === "UnifiedMedia" &&
        Object.keys(parent.parameters ?? {}).length
      )
        throw new Error("Cannot flatten UnifiedMedia parent parameters.");
      for (const clip of parent._type === "UnifiedMedia"
        ? [parent.video, parent.audio]
        : [parent])
        leaves.push({ clip, parent, track, trackIndex });
    }
  });
  if (leaves.length < 2)
    throw new Error("convert-media expects at least two synchronized streams.");
  const out = structuredClone(doc);
  const sourceBin: any[] = [],
    newTracks: any[] = [],
    attrs: any[] = [];
  let nextId = 1;
  const scan = (v: any) => {
    if (!v || typeof v !== "object") return;
    if (Number.isSafeInteger(v.id)) nextId = Math.max(nextId, v.id + 1);
    Object.values(v).forEach(scan);
  };
  scan(doc);
  const syncGroup: SyncGroup = { sources: [] };
  const used = new Set<number>();
  for (const { clip, parent, track, trackIndex } of leaves) {
    const n = clip.trackNumber;
    if (!Number.isInteger(n) || used.has(n))
      throw new Error("Each timeline stream must have a unique trackNumber.");
    used.add(n);
    const candidates = streams.filter((s) => s.trackNumber === n);
    if (candidates.length !== 1)
      throw new Error(`Missing or ambiguous converted stream ${n}.`);
    const s = candidates[0],
      audio = clip._type === "AMFile";
    if ((audio ? "audio" : "video") !== s.kind)
      throw new Error(`Stream type mismatch for ${n}.`);
    if (!/^\.\/media\/[a-zA-Z0-9_-]+\.(mp4|wav)$/.test(s.file))
      throw new Error("Converted media must use a relative ./media filename.");
    if (
      audio
        ? !(
            Number.isInteger(s.sampleRate) &&
            s.sampleRate! > 0 &&
            Number.isInteger(s.channels) &&
            s.channels! > 0
          )
        : !(
            Number.isInteger(s.width) &&
            s.width! > 0 &&
            Number.isInteger(s.height) &&
            s.height! > 0
          )
    )
      throw new Error("Invalid converted stream dimensions or audio format.");
    const id = nextId++,
      copy = structuredClone(clip);
    copy.id = nextId++;
    copy.src = id;
    copy.trackNumber = 0;
    copy._type = audio ? "AMFile" : "VMFile";
    copy.attributes = {
      ...copy.attributes,
      ident: `Recording ${n + 1} (${audio ? "audio" : "video"})`,
    };
    if (copy.attributes.sourceFileOffset)
      throw new Error("Unsupported sourceFileOffset.");
    copy.metadata = { ...parent.metadata, ...copy.metadata };
    for (const k of Object.keys(copy.parameters ?? {}))
      if (/cursor/i.test(k)) delete copy.parameters[k];
    setTiming(copy, 0, 0, duration);
    const rate = audio ? s.sampleRate! : doc.editRate;
    const rect = audio ? [0, 0, 0, 0] : [0, 0, s.width, s.height];
    const old = source.sourceTracks[n];
    sourceBin.push({
      id,
      src: s.file,
      rect,
      loudnessNormalization: source.loudnessNormalization ?? true,
      sourceTracks: [
        {
          range: [0, Math.round((duration / doc.editRate) * rate)],
          type: audio ? 2 : 0,
          editRate: rate,
          trackRect: rect,
          sampleRate: audio ? s.sampleRate : doc.videoFormatFrameRate,
          bitDepth: audio ? 16 : 0,
          numChannels: audio ? s.channels : 0,
          integratedLUFS: old?.integratedLUFS ?? 100,
          peakLevel: old?.peakLevel ?? -1,
          tag: 0,
          metaData: s.file.split("/").pop() + ";",
          parameters: {},
        },
      ],
    });
    newTracks.push({
      ...structuredClone(track),
      trackIndex: newTracks.length,
      medias: [copy],
    });
    attrs.push(
      structuredClone(doc.timeline.trackAttributes?.[trackIndex] ?? {}),
    );
    syncGroup.sources.push({ src: id, offset: 0 });
  }
  out.sourceBin = sourceBin; // no unused TREC media-bin entries remain to trigger thumbnail decoding
  out.timeline.sceneTrack.scenes[0].csml.tracks = newTracks;
  out.timeline.trackAttributes = attrs;
  return {
    doc: out,
    sourceId,
    sourcePath: source.src,
    durationSeconds: duration / doc.editRate,
    syncGroups: [syncGroup],
    warnings: [
      "Native cursor data/effects are not preserved. The decoded screen video may omit the cursor.",
      "Only the placed recording is included; unused media-bin items remain in the original project.",
    ],
  };
}
