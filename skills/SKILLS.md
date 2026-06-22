# Skills

Repo-distributed skills for camkit. Each lives in its own directory as `<name>/SKILL.md`. Add a one-line entry here when you add a skill.

Claude Code only auto-discovers skills under `.claude/skills/`, so to use these, symlink them in once per checkout:

```sh
mkdir -p .claude/skills
ln -s ../../skills/rough-cut .claude/skills/rough-cut
```

| Skill | What it does |
|-------|--------------|
| [rough-cut](rough-cut/SKILL.md) | Transcribe the on-timeline recordings of the open Camtasia project with Whisper, then cut silences, filler, false starts, and losing retakes into a tight rough cut. Optionally aligned to a script. |
