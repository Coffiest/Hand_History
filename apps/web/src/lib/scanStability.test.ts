import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCAN_CONFIG,
  evaluateScan,
  framesAreStill,
  pruneHistory,
  shouldRearm,
  type DetectFrame,
  type Quad,
} from "./scanStability";

/** A card quad centred on (cx, cy). */
function card(cx: number, cy: number): Quad {
  const w = 0.1;
  const h = 0.15;
  return [
    [cx - w, cy - h],
    [cx + w, cy - h],
    [cx + w, cy + h],
    [cx - w, cy + h],
  ];
}

/** A run of frames, `count` cards each, all in the same place. */
function stillRun(count: number, from: number, to: number, stepMs = 220): DetectFrame[] {
  const frames: DetectFrame[] = [];
  for (let t = from; t <= to; t += stepMs) {
    frames.push({ t, quads: Array.from({ length: count }, (_, i) => card(0.2 + i * 0.15, 0.5)) });
  }
  return frames;
}

describe("evaluateScan", () => {
  it("is idle with no cards", () => {
    expect(evaluateScan([], 1000)).toEqual({ kind: "idle" });
    expect(evaluateScan([{ t: 1000, quads: [] }], 1000)).toEqual({ kind: "idle" });
  });

  it("rejects counts that are not a hand or a board", () => {
    for (const count of [1, 6, 7]) {
      const state = evaluateScan(stillRun(count, 0, 1000), 1000);
      expect(state).toEqual({ kind: "invalidCount", count });
    }
  });

  it("fires once two cards have held still long enough", () => {
    const history = stillRun(2, 0, 800);
    expect(evaluateScan(history, 800)).toEqual({ kind: "ready", count: 2 });
  });

  it("fires for a 3, 4 or 5 card board", () => {
    for (const count of [3, 4, 5]) {
      const state = evaluateScan(stillRun(count, 0, 800), 800);
      expect(state).toEqual({ kind: "ready", count });
    }
  });

  it("does not fire before the stillness window elapses", () => {
    const history = stillRun(2, 0, 400);
    const state = evaluateScan(history, 400);
    expect(state.kind).toBe("settling");
    if (state.kind === "settling") {
      expect(state.progress).toBeGreaterThan(0);
      expect(state.progress).toBeLessThan(1);
    }
  });

  it("never fires while the cards are moving", () => {
    const history: DetectFrame[] = [];
    for (let i = 0; i <= 10; i++) {
      // Drifting well beyond the tolerance on every frame.
      history.push({ t: i * 220, quads: [card(0.2 + i * 0.05, 0.5), card(0.5 + i * 0.05, 0.5)] });
    }
    expect(evaluateScan(history, 2200).kind).toBe("settling");
  });

  it("restarts the countdown when a card is added mid-settle", () => {
    const history = [...stillRun(2, 0, 660), ...stillRun(3, 880, 880)];
    const state = evaluateScan(history, 880);
    // The count changed, so the 2-card stillness cannot carry over.
    expect(state).toEqual({ kind: "settling", count: 3, progress: 0 });
  });

  it("does not fire on a burst of frames that spans less than the window", () => {
    // 5 frames but only 40ms of wall clock — a fast connection must not shortcut.
    const history = stillRun(2, 0, 40, 10);
    expect(evaluateScan(history, 40).kind).toBe("settling");
  });

  it("tolerates sub-threshold jitter", () => {
    const tol = DEFAULT_SCAN_CONFIG.moveTolerance;
    const history: DetectFrame[] = [];
    for (let i = 0; i <= 5; i++) {
      const wobble = (i % 2) * (tol * 0.4);
      history.push({ t: i * 220, quads: [card(0.2 + wobble, 0.5), card(0.5 + wobble, 0.5)] });
    }
    expect(evaluateScan(history, 1100)).toEqual({ kind: "ready", count: 2 });
  });
});

describe("framesAreStill", () => {
  it("is false when the card count differs", () => {
    const a: DetectFrame = { t: 0, quads: [card(0.3, 0.5)] };
    const b: DetectFrame = { t: 220, quads: [card(0.3, 0.5), card(0.6, 0.5)] };
    expect(framesAreStill(a, b, 0.015)).toBe(false);
  });

  it("is false when any single card moved too far", () => {
    const a: DetectFrame = { t: 0, quads: [card(0.3, 0.5), card(0.6, 0.5)] };
    const b: DetectFrame = { t: 220, quads: [card(0.3, 0.5), card(0.9, 0.5)] };
    expect(framesAreStill(a, b, 0.015)).toBe(false);
  });
});

describe("shouldRearm", () => {
  it("re-arms once the cards leave the frame", () => {
    expect(shouldRearm(2, 0)).toBe(true);
  });

  it("re-arms when a different number of cards appears", () => {
    expect(shouldRearm(2, 3)).toBe(true);
  });

  it("stays disarmed while the same cards sit in frame", () => {
    expect(shouldRearm(2, 2)).toBe(false);
  });
});

describe("pruneHistory", () => {
  it("drops frames outside the window", () => {
    const history = stillRun(2, 0, 2000);
    const kept = pruneHistory(history, 2000, 1000);
    expect(kept.every((f) => f.t >= 1000)).toBe(true);
    expect(kept.length).toBeLessThan(history.length);
  });

  it("keeps the newest frame even after a long stall", () => {
    const history: DetectFrame[] = [{ t: 0, quads: [card(0.3, 0.5)] }];
    expect(pruneHistory(history, 10_000, 1000)).toHaveLength(1);
  });
});
