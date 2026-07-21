"use client";

import type { SuitCode } from "./cards";

export interface RecognizedCard {
  index: number;
  rank: number | null; // 1-13
  suit: SuitCode;
  rank_label: string;
  card_code: string;
  rank_confidence: number | null;
  suit_confidence: number;
  accepted: boolean;
}

export interface RecognizeResult {
  count: number;
  cards: RecognizedCard[];
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
 * which forwards to the Python service. Auto-detects the number of cards.
 */
export async function recognizeCards(imageBlob: Blob): Promise<RecognizeResult> {
  const form = new FormData();
  form.append("image", imageBlob, "capture.jpg");

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
