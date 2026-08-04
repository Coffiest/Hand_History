"use client";

import type { SuitCode } from "./cards";

/** Per-card intermediates, mirroring what the v3 notebook writes to _rank_debug/. */
export interface CardDebug {
  /** The straightened card crop the classifiers were given. */
  card_crop: string | null;
  /** The card as normalised for the rank scan (600x900, rotated upright). */
  rectified_image: string | null;
  /** The black-and-white digit patches actually fed to the rank classifier. */
  top_image: string | null;
  bottom_image: string | null;
  top_prediction: number | null;
  bottom_prediction: number | null;
  extraction_score: number;
  similarity: number;
  rotation: number;
  /** "split_card_direct" normally; "redetect_fallback" if the direct read failed. */
  input_mode: string | null;
  quad_method: string | null;
  candidate_count: number;
  top3: { rank: number; probability: number }[];
  suit_probabilities: Record<string, number>;
}

/** What the splitter did with the whole frame (card_splitter_first.py's outputs). */
export interface SplitterDebug {
  original: string | null;
  annotated: string | null;
  mask: string | null;
  detected_count: number;
  candidates: { index: number; area: number; aspect_ratio: number; extent: number; vertices: number }[];
}

export interface RecognizedCard {
  index: number;
  rank: number | null; // 1-13
  suit: SuitCode;
  rank_label: string;
  card_code: string;
  rank_confidence: number | null;
  suit_confidence: number;
  /** How far the read suit leads the runner-up. Older servers omit it. */
  suit_margin?: number;
  accepted: boolean;
  debug?: CardDebug | null;
}

export interface RecognizeResult {
  count: number;
  cards: RecognizedCard[];
  splitter?: SplitterDebug | null;
}

export class RecognitionError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "timeout" | "server" | "empty",
  ) {
    super(message);
  }
}

// The rank pipeline can take several seconds per card; a multi-card photo more.
const TIMEOUT_MS = 60_000;

/**
 * Uploads a captured photo to the Next.js recognition proxy (`/api/recognize`),
 * which forwards to the Python service.
 *
 * `expectedCount` matters: the scanner knows how many cards it locked onto, and
 * passing it makes the splitter keep exactly that many candidates. Without it,
 * anything card-shaped in frame — a phone, a betting slip, a hand — can come
 * back as an extra "card" and get classified as one.
 *
 * `debug` additionally returns every intermediate image behind the read.
 */
export async function recognizeCards(
  imageBlob: Blob,
  options: { expectedCount?: number; debug?: boolean } = {},
): Promise<RecognizeResult> {
  const form = new FormData();
  form.append("image", imageBlob, "capture.jpg");
  if (options.expectedCount != null) form.append("expected_count", String(options.expectedCount));
  if (options.debug) form.append("debug", "true");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("/api/recognize", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new RecognitionError("認識がタイムアウトしました。もう一度お試しください。", "timeout");
    }
    throw new RecognitionError("サーバーに接続できませんでした。", "network");
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new RecognitionError(`認識サーバーエラー (${response.status})`, "server");
  }

  const data = (await response.json()) as RecognizeResult;
  if (!data.cards || data.cards.length === 0) {
    throw new RecognitionError("カードを検出できませんでした。明るい場所で撮り直してください。", "empty");
  }
  return data;
}
