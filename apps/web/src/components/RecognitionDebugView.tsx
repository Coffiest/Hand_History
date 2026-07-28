"use client";

import { motion } from "framer-motion";
import { CloseIcon } from "./icons";
import { rankLabel } from "@/lib/cards";
import type { RecognizeResult } from "@/lib/recognitionApi";

// Shows every intermediate the recognition produced, so a bad read can be
// traced to the stage that caused it instead of guessed at.
//
// Stage 1 is card_splitter_first.py's output (source frame, detection overlay,
// edge mask). Stage 2 is per card: the crop, the rectified card, and the
// black-and-white digit patches the rank classifier actually saw — the same
// artefacts card_recognizer_integrated_v3.ipynb writes to _rank_debug/.

function Shot({ src, label, dark }: { src: string | null | undefined; label: string; dark?: boolean }) {
  return (
    <figure className="shrink-0">
      <div
        className={`rounded-xl overflow-hidden ring-1 ring-border ${dark ? "bg-ink" : "bg-surface"}`}
        style={{ width: 128, height: 128 }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- inline data URI, never optimised
          <img src={src} alt={label} className="h-full w-full object-contain" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-[11px] text-gray3">なし</div>
        )}
      </div>
      <figcaption className="mt-1 text-[10px] text-gray2 text-center w-32 leading-tight">{label}</figcaption>
    </figure>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-[11px] text-gray3 shrink-0">{label}</span>
      <span className="text-[11px] text-ink text-right tabular-nums">{value}</span>
    </div>
  );
}

export function RecognitionDebugView({
  result,
  onClose,
}: {
  result: RecognizeResult;
  onClose: () => void;
}) {
  const splitter = result.splitter;

  return (
    <motion.div
      className="fixed inset-0 z-[60] bg-bg flex flex-col"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
    >
      <header className="shrink-0 border-b border-border px-4 h-14 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">認識の詳細</h2>
          <p className="text-[11px] text-gray3">どの工程で崩れているか確認できます</p>
        </div>
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="h-10 w-10 rounded-full bg-surface flex items-center justify-center text-gray2 active:scale-95 transition-transform"
        >
          <CloseIcon size={20} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-7 pb-safe">
        {/* Stage 1 — the splitter */}
        <section>
          <h3 className="text-sm font-semibold text-ink mb-1">1. カード分離</h3>
          <p className="text-[11px] text-gray3 mb-3">card_splitter_first.py の出力</p>
          <div className="flex gap-3 overflow-x-auto pb-2">
            <Shot src={splitter?.original} label="元の写真" />
            <Shot src={splitter?.annotated} label="検出した枠" />
            <Shot src={splitter?.mask} label="エッジ（輪郭の元）" dark />
          </div>
          <div className="mt-2 rounded-2xl bg-white ring-1 ring-border px-4 py-2.5">
            <Row label="検出枚数" value={`${splitter?.detected_count ?? result.count} 枚`} />
            {splitter?.candidates?.map((c) => (
              <Row
                key={c.index}
                label={`候補 ${c.index + 1}`}
                value={`縦横比 ${c.aspect_ratio} / 矩形度 ${c.extent} / 頂点 ${c.vertices}`}
              />
            ))}
          </div>
          <p className="mt-2 text-[10px] text-gray3 leading-relaxed">
            枠がカード以外に付いていたら分離の問題です。縦横比は 1.15〜1.85、矩形度は 0.45 以上でないと候補から外れます。
          </p>
        </section>

        {/* Stage 2 — per card */}
        {result.cards.map((card) => {
          const d = card.debug;
          return (
            <section key={card.index}>
              <h3 className="text-sm font-semibold text-ink mb-1">
                2-{card.index + 1}. {card.rank_label}
                {card.suit} の判定
              </h3>
              <p className="text-[11px] text-gray3 mb-3">
                card_recognizer_integrated_v3.ipynb の _rank_debug 相当
              </p>

              <div className="flex gap-3 overflow-x-auto pb-2">
                <Shot src={d?.card_crop} label="切り抜いたカード" />
                <Shot src={d?.rectified_image} label="ランク判定用に正規化" />
                <Shot src={d?.top_image} label={`左上の数字（→ ${d?.top_prediction ?? "?"}）`} dark />
                <Shot src={d?.bottom_image} label={`右下の数字（→ ${d?.bottom_prediction ?? "?"}）`} dark />
              </div>

              <div className="mt-2 rounded-2xl bg-white ring-1 ring-border px-4 py-2.5">
                <Row label="最終判定" value={`${card.rank_label}${card.suit}`} />
                <Row
                  label="ランク確信度"
                  value={
                    card.rank_confidence != null ? `${Math.round(card.rank_confidence * 100)}%` : "—"
                  }
                />
                <Row label="抽出品質" value={d?.extraction_score ?? "—"} />
                <Row label="上下の一致度" value={d?.similarity ?? "—"} />
                <Row label="回転" value={`${d?.rotation ?? 0}°`} />
                <Row
                  label="読み取り方式"
                  value={
                    d?.input_mode === "split_card_direct"
                      ? "直接（正常）"
                      : d?.input_mode === "redetect_fallback"
                        ? "再検出（直接が失敗）"
                        : (d?.input_mode ?? "—")
                  }
                />
                <Row label="候補数" value={d?.candidate_count ?? "—"} />
              </div>

              {d?.top3 && d.top3.length > 0 && (
                <div className="mt-2 rounded-2xl bg-white ring-1 ring-border px-4 py-2.5">
                  <div className="text-[11px] text-gray3 mb-1.5">ランクの上位3候補</div>
                  {d.top3.map((t) => (
                    <div key={t.rank} className="flex items-center gap-2 py-0.5">
                      <span className="text-[11px] font-semibold text-ink w-6">
                        {rankLabel(t.rank)}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
                        <div
                          className="h-full bg-gold rounded-full"
                          style={{ width: `${Math.min(100, t.probability * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray2 tabular-nums w-10 text-right">
                        {Math.round(t.probability * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {d?.suit_probabilities && (
                <div className="mt-2 rounded-2xl bg-white ring-1 ring-border px-4 py-2.5">
                  <div className="text-[11px] text-gray3 mb-1.5">スートの確率</div>
                  {Object.entries(d.suit_probabilities).map(([code, p]) => (
                    <div key={code} className="flex items-center gap-2 py-0.5">
                      <span className="text-[11px] font-semibold text-ink w-6">{code}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
                        <div
                          className="h-full bg-gold rounded-full"
                          style={{ width: `${Math.min(100, p * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray2 tabular-nums w-10 text-right">
                        {Math.round(p * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        <p className="text-[10px] text-gray3 leading-relaxed pb-4">
          これらの画像はこの端末に表示しているだけで、サーバーには保存していません。
        </p>
      </div>
    </motion.div>
  );
}
