"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HandReplay } from "@/components/HandReplay";
import { ShareBar } from "@/components/ShareBar";
import { fetchHand, deleteHand } from "@/lib/apiClient";
import type { StoredHand } from "@/lib/handTypes";

export default function HandDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [hand, setHand] = useState<StoredHand | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHand(id)
      .then(setHand)
      .catch((e) => setError(e.message));
  }, [id]);

  const remove = async () => {
    if (!confirm("このハンドを削除しますか？")) return;
    await deleteHand(id);
    router.replace("/");
  };

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="text-gray2">{error}</div>
        <button onClick={() => router.replace("/")} className="text-gold-dark text-sm">
          ホームへ戻る
        </button>
      </div>
    );
  }

  if (!hand) {
    return <div className="min-h-screen flex items-center justify-center text-gray3">読み込み中…</div>;
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 bg-bg/80 backdrop-blur-md border-b border-border">
        <div className="max-w-lg mx-auto px-5 py-4 flex items-center justify-between">
          <button onClick={() => router.back()} className="text-sm text-gray2">
            ← 戻る
          </button>
          <h1 className="text-base font-semibold text-ink">ハンド詳細</h1>
          <button onClick={remove} className="text-sm text-suit-heart">
            削除
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-5 py-6 pb-10 space-y-6">
        <HandReplay hand={hand} />
        <ShareBar hand={hand} />
      </main>
    </div>
  );
}
