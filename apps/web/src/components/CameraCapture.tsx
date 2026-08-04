"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CloseIcon } from "@/components/icons";

// Shutter camera. The user frames the cards and presses the button; the shot
// goes to the recogniser at full resolution.
//
// This replaced an auto-firing scanner that watched a fast detection endpoint
// and captured by itself when the cards held still. It read well in testing and
// badly in the room: the poll it depended on ran the older lightweight
// detector, which is exactly the one that struggles with a white card on a pale
// table, so in practice it often never fired at all while the same cards
// recognised fine from a manual shot. Pressing a button always works, and the
// accurate split runs once, on the frame the user chose.
//
// The camera stays mounted across the whole session, so accepting a result
// returns to a live viewfinder rather than re-acquiring the stream. A file
// picker stands in when getUserMedia is unavailable (desktop / CI), which also
// keeps the flow testable without a real camera.

export function CameraCapture({
  statusText,
  canFinish,
  paused = false,
  onCapture,
  onCancel,
  onFinish,
}: {
  /** Live summary of what has been captured so far, e.g. "ホール2枚 · ボード4枚". */
  statusText?: string;
  canFinish?: boolean;
  /** True while an overlay (recognising / confirm sheet) is up. */
  paused?: boolean;
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
  onFinish?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // ── Camera lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("このブラウザではカメラを使えません。写真を選択してください。");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // Ask for the highest the device will give us: with 5 board cards in
          // frame, each card only gets a fraction of the sensor width, and the
          // rank glyph needs enough pixels to survive binarisation.
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch {
        setCameraError("カメラを起動できませんでした。設定で許可するか、写真を選択してください。");
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    setFlash(true);
    window.setTimeout(() => setFlash(false), 220);
    navigator.vibrate?.(30);

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", 0.92),
    );
    if (blob) onCaptureRef.current(blob);
  }, []);

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onCapture(file);
  };

  const canShoot = cameraReady && !paused;

  return (
    <div className="fixed inset-0 z-40 bg-black text-white flex flex-col">
      <div className="relative flex-1 overflow-hidden">
        {!cameraError ? (
          <>
            <video
              ref={videoRef}
              playsInline
              webkit-playsinline="true"
              autoPlay
              muted
              className="absolute inset-0 h-full w-full object-cover"
            />

            {/* Framing guide. Card-shaped corner brackets, sized so 2-5 cards
                laid in a row sit comfortably inside. */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="relative w-[86%] aspect-[16/10]">
                {[
                  "top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl",
                  "top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl",
                  "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl",
                  "bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl",
                ].map((cls) => (
                  <span
                    key={cls}
                    className={`absolute h-10 w-10 border-white/70 ${cls}`}
                  />
                ))}
              </div>
            </div>

            {/* Capture flash */}
            <AnimatePresence>
              {flash && (
                <motion.div
                  aria-hidden
                  className="absolute inset-0 bg-white pointer-events-none"
                  initial={{ opacity: 0.45 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22 }}
                />
              )}
            </AnimatePresence>

            {/* Top bar */}
            <div className="absolute top-0 inset-x-0 p-4 flex items-start justify-between gap-3 bg-gradient-to-b from-black/65 to-transparent">
              <button
                onClick={onCancel}
                aria-label="閉じる"
                className="h-10 w-10 rounded-full glass-dark flex items-center justify-center active:scale-95 transition-transform"
              >
                <CloseIcon size={20} />
              </button>

              {statusText && (
                <div className="flex-1 text-center pt-1.5">
                  <div className="text-[11px] text-white/75 tabular-nums">{statusText}</div>
                </div>
              )}

              {onFinish ? (
                <button
                  onClick={onFinish}
                  disabled={!canFinish}
                  className="rounded-full bg-gold text-black text-sm font-semibold px-4 py-2 shadow-gold active:scale-95 transition-transform disabled:opacity-40"
                >
                  完了
                </button>
              ) : (
                <div className="w-10" />
              )}
            </div>

            {/* Shutter */}
            <div className="absolute bottom-0 inset-x-0 pb-safe pb-8 flex flex-col items-center gap-5 bg-gradient-to-t from-black/70 to-transparent pt-16">
              <div className="text-sm font-medium px-4 py-2 rounded-full glass-dark text-white/90">
                {cameraReady ? "カードを枠に入れて撮影" : "カメラ起動中…"}
              </div>

              <button
                onClick={capture}
                disabled={!canShoot}
                aria-label="撮影"
                className="h-[76px] w-[76px] rounded-full bg-white/95 ring-4 ring-white/35 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40"
              >
                <span className="h-[60px] w-[60px] rounded-full bg-white border-2 border-black/10" />
              </button>

              <label className="text-xs font-medium text-white/70 underline underline-offset-4 px-4 py-1 cursor-pointer">
                写真を選ぶ
                <input
                  type="file"
                  accept="image/*"
                  onChange={onFilePick}
                  className="hidden"
                />
              </label>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8 text-center">
            <div className="text-white/80 text-sm max-w-xs">{cameraError}</div>
            <label className="rounded-full bg-gold text-black font-semibold px-6 py-3 cursor-pointer">
              写真を選択
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={onFilePick}
                className="hidden"
              />
            </label>
            <button onClick={onCancel} className="text-white/60 text-sm">
              キャンセル
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
