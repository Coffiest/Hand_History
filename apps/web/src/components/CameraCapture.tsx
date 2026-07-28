"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PhotoIcon } from "@/components/icons";

// Live camera with a futuristic real-time detection overlay: while framing, the
// component polls the fast /api/detect endpoint with downscaled frames and draws
// an animated bracket + scan-sweep over every card the backend currently sees.
// A manual shutter captures a full-resolution JPEG and hands it back via onCapture.
//
// Falls back to a file picker when getUserMedia is unavailable (desktop / CI),
// so the whole flow is still testable without a real camera.

type DetectedQuad = { index: number; quad: [number, number][] };

const DETECT_INTERVAL_MS = 650;
const DETECT_FRAME_MAX = 640; // downscale long edge for the detect poll

export function CameraCapture({
  title,
  hint,
  onCapture,
  onCancel,
}: {
  title: string;
  hint: string;
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectBusy = useRef(false);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [quads, setQuads] = useState<DetectedQuad[]>([]);
  const [capturing, setCapturing] = useState(false);

  // ── Camera lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("このブラウザではカメラを利用できません。");
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
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
      } catch {
        setCameraError("カメラを起動できませんでした。権限を確認するか、写真を選択してください。");
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

  // ── Real-time detection polling ───────────────────────────────────────────
  useEffect(() => {
    if (!cameraReady) return;
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
                setQuads(data.boxes ?? []);
              }
            }
          }
        } catch {
          /* detection is best-effort; ignore transient errors */
        } finally {
          detectBusy.current = false;
        }
      }
      if (!stop) setTimeout(tick, DETECT_INTERVAL_MS);
    }
    const t = setTimeout(tick, 400);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [cameraReady, grabFrame]);

  // ── Draw detection overlay ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // object-cover mapping: the video fills the box, cropping the longer axis.
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const scale = Math.max(canvas.width / vw, canvas.height / vh);
    const dispW = vw * scale;
    const dispH = vh * scale;
    const offX = (canvas.width - dispW) / 2;
    const offY = (canvas.height - dispH) / 2;
    const mapX = (nx: number) => offX + nx * dispW;
    const mapY = (ny: number) => offY + ny * dispH;

    for (const box of quads) {
      const pts = box.quad.map(([nx, ny]) => [mapX(nx), mapY(ny)] as [number, number]);
      // Glow frame
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(242,169,0,0.95)";
      ctx.shadowColor = "rgba(242,169,0,0.9)";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
      ctx.closePath();
      ctx.stroke();
      // Corner brackets
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
  }, [quads]);

  // ── Shutter ───────────────────────────────────────────────────────────────
  const shoot = useCallback(async () => {
    setCapturing(true);
    const canvas = grabFrame(); // full resolution
    if (!canvas) {
      setCapturing(false);
      return;
    }
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.92));
    setCapturing(false);
    if (blob) onCapture(blob);
  }, [grabFrame, onCapture]);

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onCapture(file);
  };

  const detecting = quads.length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col">
      {/* Camera / fallback */}
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

            {/* Animated scan sweep */}
            {cameraReady && (
              <motion.div
                aria-hidden
                className="absolute inset-x-0 h-24 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(242,169,0,0) 0%, rgba(242,169,0,0.18) 50%, rgba(242,169,0,0) 100%)",
                }}
                initial={{ top: "0%" }}
                animate={{ top: ["0%", "88%", "0%"] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              />
            )}

            {/* Top bar */}
            <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent">
              <button onClick={onCancel} className="text-sm font-medium text-white/90 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur">
                キャンセル
              </button>
              <div className="text-center">
                <div className="text-sm font-semibold">{title}</div>
                <div className="text-[11px] text-white/70">{hint}</div>
              </div>
              <div className="w-[72px]" />
            </div>

            {/* Detection status pill */}
            <div className="absolute top-20 inset-x-0 flex justify-center pointer-events-none">
              <AnimatePresence>
                <motion.div
                  key={detecting ? "found" : "searching"}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full backdrop-blur ${
                    detecting ? "bg-gold/90 text-black" : "bg-white/10 text-white/80"
                  }`}
                >
                  {cameraReady
                    ? detecting
                      ? `${quads.length}枚 検出中`
                      : "カードを枠に収めてください…"
                    : "カメラ起動中…"}
                </motion.div>
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

      {/* Shutter bar */}
      {!cameraError && (
        <div className="pb-safe pt-4 bg-black flex items-center justify-center gap-10">
          <label className="text-white/70 text-xs flex flex-col items-center gap-1 cursor-pointer">
            <span className="h-11 w-11 rounded-full bg-white/10 flex items-center justify-center text-white">
              <PhotoIcon size={22} />
            </span>
            写真
            <input type="file" accept="image/*" onChange={onFilePick} className="hidden" />
          </label>
          <button
            onClick={shoot}
            disabled={!cameraReady || capturing}
            aria-label="撮影"
            className="h-[74px] w-[74px] rounded-full bg-white ring-4 ring-white/30 active:scale-90 transition-transform disabled:opacity-40 flex items-center justify-center"
          >
            <span className="h-[62px] w-[62px] rounded-full border-2 border-black/10 bg-white" />
          </button>
          <div className="w-11" />
        </div>
      )}
    </div>
  );
}
