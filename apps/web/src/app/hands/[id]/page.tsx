"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HandReplay } from "@/components/HandReplay";
import { ShareBar } from "@/components/ShareBar";
import { VersionTag } from "@/components/AppShell";
import { ChevronLeftIcon, StarIcon, TrashIcon } from "@/components/icons";
import { getHand, removeHand, setFavorite } from "@/lib/handStore";
import type { StoredHand } from "@/lib/handTypes";

export default function HandDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [hand, setHand] = useState<StoredHand | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    getHand(id).then((h) => (h ? setHand(h) : setMissing(true)));
  }, [id]);

  const toggleFav = async () => {
    if (!hand) return;
    const next = !hand.favorite;
    setHand({ ...hand, favorite: next });
    await setFavorite(hand.id, next);
  };

  const remove = async () => {
    if (!confirm("このハンドを削除しますか？")) return;
    await removeHand(id);
    router.replace("/");
  };

  if (missing) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="text-gray2">ハンドが見つかりませんでした。</div>
        <button onClick={() => router.replace("/")} className="text-gold-dark text-sm font-medium">
          ホームへ戻る
        </button>
      </div>
    );
  }

  if (!hand) {
    return <div className="min-h-screen bg-bg flex items-center justify-center text-gray3 text-sm">読み込み中…</div>;
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="sticky top-0 z-10 bg-bg/85 backdrop-blur-md border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray2 active:scale-95 transition-transform">
            <ChevronLeftIcon size={18} /> 戻る
          </button>
          <h1 className="text-base font-semibold text-ink">ハンド詳細</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleFav}
              aria-label={hand.favorite ? "お気に入りから外す" : "お気に入りに追加"}
              className={`h-11 w-11 rounded-full flex items-center justify-center active:scale-90 transition-transform ${
                hand.favorite ? "text-gold" : "text-gray3"
              }`}
            >
              <StarIcon size={20} filled={hand.favorite} />
            </button>
            <button
              onClick={remove}
              aria-label="削除"
              className="h-11 w-11 rounded-full flex items-center justify-center text-suit-heart active:scale-90 transition-transform"
            >
              <TrashIcon size={19} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-lg mx-auto px-5 py-6 space-y-6">
        <HandReplay hand={hand} />
        <ShareBar hand={hand} />
      </main>

      <footer className="pb-safe pb-4">
        <VersionTag />
      </footer>
    </div>
  );
}
