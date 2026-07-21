"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CameraCapture } from "./CameraCapture";
import { CardConfirmSheet, type ConfirmCard } from "./CardConfirmSheet";
import { recognizeCards, RecognitionError, type RecognizedCard } from "@/lib/recognitionApi";

type Phase =
  | { s: "camera" }
  | { s: "recognizing" }
  | { s: "confirm"; cards: RecognizedCard[] }
  | { s: "error"; message: string; blob: Blob };

// End-to-end capture: camera → (multi-second) recognition with a loading state →
// confirm/fix → returns the final cards. Used for both hole cards and the board.
export function CaptureFlow({
  title,
  hint,
  expectedCount,
  onDone,
  onCancel,
}: {
  title: string;
  hint: string;
  expectedCount?: number;
  onDone: (cards: ConfirmCard[]) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ s: "camera" });

  async function recognize(blob: Blob) {
    setPhase({ s: "recognizing" });
    try {
      const result = await recognizeCards(blob);
      setPhase({ s: "confirm", cards: result.cards });
    } catch (err) {
      const message = err instanceof RecognitionError ? err.message : "認識に失敗しました。";
      setPhase({ s: "error", message, blob });
    }
  }

  if (phase.s === "camera") {
    return (
      <CameraCapture
        title={title}
        hint={hint}
        onCapture={(blob) => recognize(blob)}
        onCancel={onCancel}
      />
    );
  }

  if (phase.s === "recognizing") {
    return (
      <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center gap-6 text-white">
        <motion.div
          className="h-16 w-16 rounded-full border-4 border-white/20 border-t-gold"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
        <div className="text-center">
          <div className="text-base font-semibold">カードを認識しています…</div>
          <div className="text-sm text-white/60 mt-1">数秒かかることがあります</div>
        </div>
      </div>
    );
  }

  if (phase.s === "error") {
    return (
      <div className="fixed inset-0 z-50 bg-bg flex flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="text-4xl">😕</div>
        <div className="text-ink font-medium max-w-xs">{phase.message}</div>
        <div className="flex gap-3">
          <button onClick={() => setPhase({ s: "camera" })} className="px-6 py-3 rounded-2xl bg-surface ring-1 ring-border text-gray2 font-medium">
            撮り直す
          </button>
          <button onClick={() => recognize(phase.blob)} className="px-6 py-3 rounded-2xl bg-gold text-black font-semibold">
            再試行
          </button>
        </div>
        <button onClick={onCancel} className="text-gray3 text-sm">
          キャンセル
        </button>
      </div>
    );
  }

  return (
    <CardConfirmSheet
      recognized={phase.cards}
      expectedCount={expectedCount}
      onConfirm={onDone}
      onRetake={() => setPhase({ s: "camera" })}
    />
  );
}
