"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CameraIcon, CloseIcon } from "@/components/icons";
import {
  DEFAULT_SCAN_CONFIG,
  evaluateScan,
  pruneHistory,
  shouldRearm,
  type DetectFrame,
  type ScanState,
} from "@/lib/scanStability";

// Auto-scanning camera, in the spirit of a QR reader: point it at the cards and
// it fires by itself. It polls the fast /api/detect endpoint, tracks where the
// cards are frame to frame, and captures a full-resolution JPEG the moment a
// valid set of cards has held still (see lib/scanStability.ts for the rules).
//
// There is deliberately no shutter button. If detection cannot get a lock for a
// while — dim room, patterned felt — a manual capture button fades in as an
// escape hatch. A file picker also stands in when getUserMedia is unavailable
// (desktop / CI), so the whole flow stays testable without a real camera.

type DetectedQuad = { index: number; quad: [number, number][] };

const DETECT_INTERVAL_MS = 220; // detect costs ~5ms server-side; this is network-bound
const DETECT_FRAME_MAX = 640; // downscale long edge for the detect poll
const HISTORY_WINDOW_MS = 2000;
const MANUAL_FALLBACK_AFTER_MS = 8000;

function guidance(state: ScanState, cameraReady: boolean): string {
  if (!cameraReady) return "カメラ起動中…";
  switch (state.kind) {
    case "idle":
      return "カードをかざしてください";
    case "invalidCount":
      return state.count < 2
        ? "カードを2枚、または3〜5枚写してください"
        : `${state.count}枚は多すぎます`;
    case "settling":
      return "そのまま静止…";
    case "ready":
      return "読み取り中…";
  }
}

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
  /** Stop polling while an overlay (recognising / confirm sheet) is up. */
  paused?: boolean;
  /** `count` is how many cards the scanner locked onto for this shot. */
  onCapture: (blob: Blob, count?: number) => void;
  onCancel: () => void;
  onFinish?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectBusy = useRef(false);
  const historyRef = useRef<DetectFrame[]>([]);
  const armedRef = useRef(true);
  const capturedCountRef = useRef(0);
  const lastLockRef = useRef<number>(0);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [quads, setQuads] = useState<DetectedQuad[]>([]);
  const [scanState, setScanState] = useState<ScanState>({ kind: "idle" });
  const [showManual, setShowManual] = useState(false);
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
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
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

  // Grab the current video frame into a canvas, optionally downscaled.
  const grabFrame = useCallback((maxEdge?: number): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = maxEdge ? Math.min(1, maxEdge / Math.max(vw, vh)) : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  const captureFullFrame = useCallback(
    async (count?: number) => {
      const canvas = grabFrame(); // full resolution
      if (!canvas) return;
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.92));
      if (blob) onCaptureRef.current(blob, count);
    },
    [grabFrame],
  );

  // ── Detection polling + auto-fire ─────────────────────────────────────────
  useEffect(() => {
    if (!cameraReady || paused) return;
    let stop = false;

    async function tick() {
      if (stop) return;
      if (!detectBusy.current) {
        detectBusy.current = true;
        try {
          const canvas = grabFrame(DETECT_FRAME_MAX);
          if (canvas) {
            const blob = await new Promise<Blob | null>((res) =>
              canvas.toBlob((b) => res(b), "image/jpeg", 0.6),
            );
            if (blob) {
              const form = new FormData();
              form.append("image", blob, "frame.jpg");
              const res = await fetch("/api/detect", { method: "POST", body: form });
              if (res.ok && !stop) {
                const data = (await res.json()) as { boxes: DetectedQuad[] };
                const boxes = data.boxes ?? [];
                setQuads(boxes);

                const now = performance.now();
                historyRef.current = pruneHistory(
                  [...historyRef.current, { t: now, quads: boxes.map((b) => b.quad) }],
                  now,
                  HISTORY_WINDOW_MS,
                );

                // A capture disarms the scanner so a card left in frame is not
                // shot repeatedly; the scene has to change before it re-arms.
                if (!armedRef.current && shouldRearm(capturedCountRef.current, boxes.length)) {
                  armedRef.current = true;
                }

                const state = evaluateScan(historyRef.current, now, DEFAULT_SCAN_CONFIG);
                setScanState(state);

                if (state.kind === "ready" && armedRef.current) {
                  armedRef.current = false;
                  capturedCountRef.current = state.count;
                  lastLockRef.current = now;
                  setShowManual(false);
                  setFlash(true);
                  window.setTimeout(() => setFlash(false), 220);
                  navigator.vibrate?.(30);
                  await captureFullFrame(state.count);
                } else if (state.kind === "ready" || state.kind === "settling") {
                  lastLockRef.current = now;
                  setShowManual(false);
                } else if (now - lastLockRef.current > MANUAL_FALLBACK_AFTER_MS) {
                  // Nothing has locked on for a while — offer a way out.
                  setShowManual(true);
                }
              }
            }
          }
        } catch {
          /* detection is best-effort; ignore transient errors */
        } finally {
          detectBusy.current = false;
        }
      }
      if (!stop) window.setTimeout(tick, DETECT_INTERVAL_MS);
    }

    lastLockRef.current = performance.now();
    const t = window.setTimeout(tick, 300);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [cameraReady, paused, grabFrame, captureFullFrame]);

  // Clear stale detections while paused so the overlay does not linger.
  useEffect(() => {
    if (paused) {
      setQuads([]);
      setScanState({ kind: "idle" });
      historyRef.current = [];
    }
  }, [paused]);

  // ── Draw detection overlay ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // object-cover mapping: the video fills the box, cropping the longer axis.
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const scale = Math.max(rect.width / vw, rect.height / vh);
    const dispW = vw * scale;
    const dispH = vh * scale;
    const offX = (rect.width - dispW) / 2;
    const offY = (rect.height - dispH) / 2;
    const mapX = (nx: number) => offX + nx * dispW;
    const mapY = (ny: number) => offY + ny * dispH;

    // Grey while the count is wrong, gold once we are counting down to a shot.
    const locked = scanState.kind === "settling" || scanState.kind === "ready";
    const stroke = locked ? "rgba(242,169,0,0.95)" : "rgba(255,255,255,0.55)";

    for (const box of quads) {
      const pts = box.quad.map(([nx, ny]) => [mapX(nx), mapY(ny)] as [number, number]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = stroke;
      ctx.shadowColor = locked ? "rgba(242,169,0,0.9)" : "transparent";
      ctx.shadowBlur = locked ? 16 : 0;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
      ctx.closePath();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 3;
      const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
      const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
      for (const p of pts) {
        const dx = (cx - p[0]) * 0.22;
        const dy = (cy - p[1]) * 0.22;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(p[0] + dx, p[1]);
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(p[0], p[1] + dy);
        ctx.stroke();
      }
    }
  }, [quads, scanState]);

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onCapture(file);
  };

  const progress = scanState.kind === "settling" ? scanState.progress : scanState.kind === "ready" ? 1 : 0;
  const locked = scanState.kind === "settling" || scanState.kind === "ready";

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
            <canvas ref={overlayRef} className="absolute inset-0 h-full w-full pointer-events-none" />

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

            {/* Guidance + settle ring */}
            <div className="absolute bottom-0 inset-x-0 pb-safe pb-10 flex flex-col items-center gap-4 bg-gradient-to-t from-black/65 to-transparent pt-16 pointer-events-none">
              <div className="relative h-16 w-16">
                <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
                  <defs>
                    <linearGradient id="irisRing" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#F2A900" />
                      <stop offset="40%" stopColor="#FF6B9D" />
                      <stop offset="75%" stopColor="#7C6FFF" />
                      <stop offset="100%" stopColor="#4ED0C1" />
                    </linearGradient>
                  </defs>
                  <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="4" />
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="url(#irisRing)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 28}
                    strokeDashoffset={2 * Math.PI * 28 * (1 - progress)}
                    style={{ transition: "stroke-dashoffset 180ms linear" }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <CameraIcon size={24} className={locked ? "text-gold" : "text-white/60"} />
                </div>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={guidance(scanState, cameraReady)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className={`text-sm font-medium px-4 py-2 rounded-full backdrop-blur ${
                    locked ? "bg-gold/90 text-black" : "glass-dark text-white/90"
                  }`}
                >
                  {guidance(scanState, cameraReady)}
                </motion.div>
              </AnimatePresence>

              {/* Escape hatch: only appears when auto-detection cannot get a lock. */}
              <AnimatePresence>
                {showManual && (
                  <motion.button
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    onClick={() => captureFullFrame(quads.length || undefined)}
                    className="pointer-events-auto text-xs font-medium text-white/80 underline underline-offset-4 px-4 py-2"
                  >
                    うまく読めないときは手動で撮影
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8 text-center">
            <div className="text-white/80 text-sm max-w-xs">{cameraError}</div>
            <label className="rounded-full bg-gold text-black font-semibold px-6 py-3 cursor-pointer">
              写真を選択
              <input type="file" accept="image/*" capture="environment" onChange={onFilePick} className="hidden" />
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
