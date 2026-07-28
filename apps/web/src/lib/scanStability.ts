// Stability logic for the auto-scanning camera, kept DOM-free so it can be
// unit tested. The camera feeds it a short history of detection frames and it
// answers one question: "is a valid set of cards sitting still long enough to
// shoot?"

/** Four corner points, each normalised to 0..1 of the source frame. */
export type Quad = [number, number][];

export type DetectFrame = {
  /** Timestamp in ms (performance.now()). */
  t: number;
  quads: Quad[];
};

export type ScanState =
  | { kind: "idle" }
  | { kind: "invalidCount"; count: number }
  | { kind: "settling"; count: number; progress: number }
  | { kind: "ready"; count: number };

/** 2 = hole cards, 3-5 = board. A single card is never a valid capture. */
export const VALID_COUNTS = [2, 3, 4, 5] as const;

export type ScanConfig = {
  /** How long the cards must hold still before firing. */
  stillMs: number;
  /** Max centroid movement between frames, as a fraction of the frame diagonal. */
  moveTolerance: number;
  validCounts: readonly number[];
};

export const DEFAULT_SCAN_CONFIG: ScanConfig = {
  stillMs: 700,
  moveTolerance: 0.015,
  validCounts: VALID_COUNTS,
};

export function centroid(quad: Quad): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of quad) {
    sx += x;
    sy += y;
  }
  const n = quad.length || 1;
  return [sx / n, sy / n];
}

/**
 * Whether every card sits in the same place across two frames. Detection
 * returns cards left-to-right, so index-to-index comparison is well defined as
 * long as the count matches.
 */
export function framesAreStill(a: DetectFrame, b: DetectFrame, tolerance: number): boolean {
  if (a.quads.length !== b.quads.length) return false;
  for (let i = 0; i < a.quads.length; i++) {
    const qa = a.quads[i];
    const qb = b.quads[i];
    if (!qa || !qb) return false;
    const [ax, ay] = centroid(qa);
    const [bx, by] = centroid(qb);
    if (Math.hypot(ax - bx, ay - by) > tolerance) return false;
  }
  return true;
}

/**
 * Decide what the scanner should be doing, given recent detections.
 *
 * `ready` requires the newest frame to hold a valid card count and for every
 * frame inside the stillness window to agree on where those cards are. The
 * window must actually span `stillMs` — a burst of frames arriving in 100ms
 * cannot satisfy it, so a slow connection delays firing rather than faking it.
 */
export function evaluateScan(
  history: DetectFrame[],
  now: number,
  config: ScanConfig = DEFAULT_SCAN_CONFIG,
): ScanState {
  const latest = history[history.length - 1];
  if (!latest || latest.quads.length === 0) return { kind: "idle" };

  const count = latest.quads.length;
  if (!config.validCounts.includes(count)) return { kind: "invalidCount", count };

  // Walk backwards while the cards stay put, to find when they settled.
  let settledAt = latest.t;
  for (let i = history.length - 1; i > 0; i--) {
    const newer = history[i];
    const older = history[i - 1];
    if (!newer || !older) break;
    if (older.quads.length !== count) break;
    if (!framesAreStill(newer, older, config.moveTolerance)) break;
    settledAt = older.t;
  }

  const heldFor = now - settledAt;
  if (heldFor >= config.stillMs) return { kind: "ready", count };

  return {
    kind: "settling",
    count,
    progress: Math.max(0, Math.min(1, heldFor / config.stillMs)),
  };
}

/**
 * After a capture the scanner disarms so a card left in frame is not shot over
 * and over. It re-arms once the scene changes: the cards leave, or a different
 * number of them appears (e.g. hole cards captured, now the flop is held up).
 */
export function shouldRearm(capturedCount: number, currentCount: number): boolean {
  return currentCount === 0 || currentCount !== capturedCount;
}

/** Drop frames that are too old to matter, so the history stays small. */
export function pruneHistory(history: DetectFrame[], now: number, keepMs: number): DetectFrame[] {
  const cutoff = now - keepMs;
  const kept = history.filter((f) => f.t >= cutoff);
  // Always keep at least the newest frame, even if polling stalled.
  return kept.length > 0 ? kept : history.slice(-1);
}
