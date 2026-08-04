"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CameraCapture } from "./CameraCapture";
import { CardConfirmSheet, type CardRole, type ConfirmCard } from "./CardConfirmSheet";
import { AlertIcon } from "@/components/icons";
import { RecognitionDebugView } from "./RecognitionDebugView";
import { recognizeCards, RecognitionError, type RecognizeResult } from "@/lib/recognitionApi";

// A continuous scanning session. The camera is mounted for the whole session —
// recognising and confirming are layered on top of it — so accepting a result
// returns to a live viewfinder instantly instead of re-acquiring the stream.
//
// Cards are routed by count: 2 is a hand, 3-5 is a board. The sheet lets the
// user override that, and the board is always replaced wholesale, which is what
// re-shooting the whole board on the turn and river naturally produces.

type Phase =
  | { s: "scanning" }
  | { s: "recognizing" }
  | { s: "confirm"; result: RecognizeResult }
  | { s: "error"; message: string; blob: Blob };

export type CaptureResult = { hole: ConfirmCard[]; board: ConfirmCard[] };

export function CaptureFlow({
  initialHole = [],
  initialBoard = [],
  onDone,
  onCancel,
}: {
  initialHole?: ConfirmCard[];
  initialBoard?: ConfirmCard[];
  onDone: (result: CaptureResult) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ s: "scanning" });
  const [hole, setHole] = useState<ConfirmCard[]>(initialHole);
  const [board, setBoard] = useState<ConfirmCard[]>(initialBoard);
  const [debugResult, setDebugResult] = useState<RecognizeResult | null>(null);

  // No expected count is passed: the shot is whatever the user framed, and the
  // splitter decides how many cards are in it. Debug images always come with
  // the result — they are what makes a bad read diagnosable instead of
  // mysterious.
  async function recognize(blob: Blob) {
    setPhase({ s: "recognizing" });
    try {
      const result = await recognizeCards(blob, { debug: true });
      setPhase({ s: "confirm", result });
    } catch (err) {
      const message = err instanceof RecognitionError ? err.message : "認識に失敗しました。";
      setPhase({ s: "error", message, blob });
    }
  }

  function accept(cards: ConfirmCard[], role: CardRole) {
    if (role === "hole") setHole(cards);
    else setBoard(cards);
    setPhase({ s: "scanning" });
  }

  const statusParts: string[] = [];
  if (hole.length) statusParts.push(`ホール${hole.length}枚`);
  if (board.length) statusParts.push(`ボード${board.length}枚`);
  const statusText = statusParts.length ? statusParts.join(" · ") : "カードを枠に入れて撮影してください";

  return (
    <>
      <CameraCapture
        statusText={statusText}
        canFinish={hole.length > 0 || board.length > 0}
        paused={phase.s !== "scanning"}
        onCapture={recognize}
        onCancel={onCancel}
        onFinish={() => onDone({ hole, board })}
      />

      <AnimatePresence>
        {phase.s === "recognizing" && (
          <motion.div
            key="recognizing"
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="h-12 w-12 rounded-full border-[3px] border-white/25 border-t-gold animate-spin" />
            <div className="text-white font-medium">カードを読み取っています…</div>
            <div className="text-white/60 text-xs">数秒かかります</div>
          </motion.div>
        )}

        {phase.s === "confirm" && (
          <CardConfirmSheet
            key="confirm"
            recognized={phase.result.cards}
            onConfirm={accept}
            onRetake={() => setPhase({ s: "scanning" })}
            onShowDebug={() => setDebugResult(phase.result)}
          />
        )}

        {phase.s === "error" && (
          <motion.div
            key="error"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] glass-strong iris-edge p-6 pb-safe"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
          >
            <div className="flex flex-col items-center gap-4 text-center pb-4">
              <div className="h-14 w-14 rounded-2xl bg-gold/10 text-gold-dark flex items-center justify-center">
                <AlertIcon size={26} />
              </div>
              <div className="text-ink font-medium max-w-xs">{phase.message}</div>
              <div className="flex gap-3 w-full pt-1">
                <button
                  onClick={() => setPhase({ s: "scanning" })}
                  className="flex-1 py-3.5 rounded-2xl bg-white/70 text-gray2 font-medium ring-1 ring-border active:scale-[0.98] transition-transform"
                >
                  撮り直す
                </button>
                <button
                  onClick={() => recognize(phase.blob)}
                  className="flex-[2] py-3.5 rounded-2xl bg-gold text-black font-semibold shadow-gold active:scale-[0.98] transition-transform"
                >
                  再試行
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {debugResult && (
          <RecognitionDebugView result={debugResult} onClose={() => setDebugResult(null)} />
        )}
      </AnimatePresence>
    </>
  );
}
