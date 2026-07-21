"use client";

import { useState } from "react";
import { handToPlainText } from "@/lib/handHistoryText";
import { createShareToken } from "@/lib/apiClient";
import type { StoredHand } from "@/lib/handTypes";

// Share actions: copy plain text, share/copy a public replay link, or download
// an image. Mirrors RRPoker's Web-Share-with-clipboard-fallback pattern.
export function ShareBar({ hand }: { hand: StoredHand }) {
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const copyText = async () => {
    await navigator.clipboard.writeText(handToPlainText(hand));
    flash("テキストをコピーしました");
  };

  const shareLink = async () => {
    try {
      const token = hand.shareToken ?? (await createShareToken(hand.id));
      const url = `${window.location.origin}/share/${token}`;
      if (navigator.share) {
        await navigator.share({ title: "ポーカーハンド", url }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(url);
        flash("共有リンクをコピーしました");
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : "共有に失敗しました");
    }
  };

  const shareImage = async () => {
    try {
      const token = hand.shareToken ?? (await createShareToken(hand.id));
      window.open(`/api/share/${token}/image`, "_blank");
    } catch (e) {
      flash(e instanceof Error ? e.message : "画像の生成に失敗しました");
    }
  };

  return (
    <div className="relative">
      <div className="grid grid-cols-3 gap-2">
        <button onClick={copyText} className="rounded-2xl bg-surface ring-1 ring-border py-3 text-sm font-medium text-ink active:scale-95 transition-transform">
          📝 文字
        </button>
        <button onClick={shareImage} className="rounded-2xl bg-surface ring-1 ring-border py-3 text-sm font-medium text-ink active:scale-95 transition-transform">
          🖼️ 画像
        </button>
        <button onClick={shareLink} className="rounded-2xl bg-gold text-black py-3 text-sm font-semibold active:scale-95 transition-transform">
          🔗 共有
        </button>
      </div>
      {toast && (
        <div className="absolute -top-11 inset-x-0 flex justify-center">
          <span className="text-xs bg-ink text-white px-3 py-1.5 rounded-full shadow-lift">{toast}</span>
        </div>
      )}
    </div>
  );
}
