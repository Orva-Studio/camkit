import { describe, expect, test } from "bun:test";
import { planPrune, proxyKey, type ProxyEntry } from "../src/proxies.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const entry = (name: string, ageDays: number, size = 1000): ProxyEntry => ({
  name,
  size,
  mtimeMs: NOW - ageDays * DAY,
});

describe("proxyKey", () => {
  test("matches Camtasia's <basename-sans-ext>_<size>.ief scheme", () => {
    expect(proxyKey("/a/b/outro.trec", 364787679)).toBe("outro_364787679.ief");
    expect(proxyKey("camera_intro.mp4", 109922659)).toBe("camera_intro_109922659.ief");
  });

  test("only strips the final extension", () => {
    expect(proxyKey("/x/take.v2.final.mov", 5)).toBe("take.v2.final_5.ief");
  });
});

describe("planPrune", () => {
  test("removes everything by default", () => {
    const plan = planPrune([entry("a.ief", 0), entry("b.ief", 90)], { now: NOW });
    expect(plan.remove.map((e) => e.name)).toEqual(["a.ief", "b.ief"]);
    expect(plan.keep).toEqual([]);
  });

  test("keepKeys always survive, regardless of age", () => {
    const plan = planPrune([entry("keep.ief", 400), entry("go.ief", 400)], {
      keepKeys: new Set(["keep.ief"]),
      now: NOW,
    });
    expect(plan.remove.map((e) => e.name)).toEqual(["go.ief"]);
    expect(plan.keep.map((e) => e.name)).toEqual(["keep.ief"]);
  });

  test("olderThanDays spares recent entries", () => {
    const plan = planPrune([entry("new.ief", 2), entry("old.ief", 31)], {
      olderThanDays: 30,
      now: NOW,
    });
    expect(plan.remove.map((e) => e.name)).toEqual(["old.ief"]);
    expect(plan.keep.map((e) => e.name)).toEqual(["new.ief"]);
  });
});
