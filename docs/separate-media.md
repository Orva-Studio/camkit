# Editable cuts with separate screen, camera and audio sources

`convert-media` creates a new `.cmproj` with one editable MP4/WAV track for
each placed recording stream. It never edits the input project, Camtasia
preferences, presets or proxy cache. Keep an independent backup of the original
bundle before a production edit.

```sh
camkit convert-media --project original.cmproj --out working.cmproj --dry-run
camkit convert-media --project original.cmproj --out working.cmproj --acknowledge-cursor-loss
```

Requirements: ffmpeg and ffprobe, H.264 encoding, and a decoder for the source
recording (including tscc2 for screen recordings). Conversion can take minutes
and uses additional disk space. MP4 conversion loses native cursor metadata,
including editable cursor enlargement/highlighting; the decoded screen video
may omit the cursor itself. It retains static media scale, crop, position,
audio gain and track visibility/mute settings. It includes only the recording
placed on the timeline, not unused TREC entries in the media bin.

The initial supported input is a single uncut recording with synchronized clips
starting at zero. Effects, animations, speed changes, mixed-source UnifiedMedia,
multiple clips of a source on a track and other unsupported structures fail
before conversion. Source streams are checked against the probe's types,
dimensions and durations. Nonzero audio start times are padded with silence;
nonzero video start times are currently refused. The last decoded video frame
may be held for up to one second to cover a TREC tail whose declared duration
exceeds its decoded frames; output is trimmed to the original timeline duration. All output streams are checked
for zero start time and duration before the project is written. Output must not
already exist. A failed conversion removes only the output directory it created.

## One cut plan for multiple sources

Conversion writes `working.cmproj/sync-groups.json`, for example:

```json
[{"sources":[{"src":10,"offset":0},{"src":12,"offset":0},{"src":14,"offset":0}]}]
```

The first source is the reference clock. `offset` means **member source time
minus reference source time**, in seconds. For manually synchronized files, a
member with `offset: 0.25` uses source time 10.25 when the reference uses 10.
The group's sources must occupy distinct tracks and each source can belong to
only one group. Supply offsets explicitly; camkit does not infer synchronization.

Use the first source ID in the keep list (use the IDs in the generated file,
not the example numbers):

```json
{"keep":[{"src":10,"start":1,"end":12},{"src":10,"start":14,"end":20}]}
```

```sh
camkit rebuild --project working.cmproj --from keep.json \
  --sync-groups working.cmproj/sync-groups.json --dry-run
camkit rebuild --project working.cmproj --from keep.json \
  --sync-groups working.cmproj/sync-groups.json
```

Cut boundaries are rounded once to reference video frames; offsets are rounded
to project units. Every member gets exactly the same timeline start and duration,
with globally unique clip IDs. All member source bounds are checked both before
and after rounding. Dry-run entries report the actual rounded reference times.

Rebuild remains a source-time rough-cut operation, not a general retiming engine
for finished projects. It now refuses repeated source clips on a track and
unsupported effects/keyframes instead of cloning only the first clip and silently
losing later edits. Use the uncut original for a new cut plan. Existing lock and
`.bak` protections still apply; `--force` does not bypass timeline validation.

Transcribe separately, select complete takes, check real silences, then supply an
explicit keep plan. Local Whisper uses full JSON for token offsets and omits
reversed token timestamps from word results while retaining segment text.
Transcripts can still have inaccurate timestamps and hallucinations during long
silences; do not treat every inferred word boundary as an exact audio cut point.

## Validation limits

This workflow avoids native TREC references in the generated project, motivated
by [issue #17](https://github.com/Orva-Studio/camkit/issues/17). It does not fix or
prove the absence of a Camtasia decoder bug. Validate playback, save/reopen and
native export on a project copy before adopting it for production. Keep the
original TREC for cursor features and further editing.
