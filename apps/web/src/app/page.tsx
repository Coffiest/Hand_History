"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/useAuth";
import { LoginScreen } from "@/components/LoginScreen";
import { fetchHands } from "@/lib/apiClient";
import { PlayingCard } from "@/components/PlayingCard";
import { cardDisplay } from "@/lib/cards";
import type { StoredHand } from "@/lib/handTypes";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function HandRow({ hand }: { hand: StoredHand }) {
  const hole = hand.cards.filter((c) => c.role === "hole").sort((a, b) => a.position - b.position);
  const result = hand.resultAmount;
  return (
    <Link href={`/hands/${hand.id}`}>
      <motion.div
        layout
        className="flex items-center gap-3 rounded-2xl bg-white ring-1 ring-border p-3 shadow-card active:scale-[0.99] transition-transform"
      >
        <div className="flex gap-1">
          {hole.length > 0 ? (
            hole.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
          ) : (
            <>
              <PlayingCard empty size="sm" />
              <PlayingCard empty size="sm" />
            </>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink truncate">
            {hand.title || (hole.length ? hole.map(cardDisplay).join(" ") : "ハンド")}
          </div>
          <div className="text-xs text-gray3">
            {formatDate(hand.createdAt)}
            {hand.heroPosition ? ` · ${hand.heroPosition}` : ""}
          </div>
        </div>
        {result != null && (
          <div className={`text-sm font-bold ${result >= 0 ? "text-suit-club" : "text-suit-heart"}`}>
            {result >= 0 ? "+" : ""}
            {result}
          </div>
        )}
      </motion.div>
    </Link>
  );
}

export default function HomePage() {
  const auth = useAuth();
  const [hands, setHands] = useState<StoredHand[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loggedIn = Boolean(auth.session) || !auth.authAvailable;

  useEffect(() => {
    if (!loggedIn || auth.loading) return;
    fetchHands()
      .then(setHands)
      .catch((e) => setError(e.message));
  }, [loggedIn, auth.loading]);

  if (auth.loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray3">読み込み中…</div>;
  }

  if (auth.authAvailable && !auth.session) {
    return <LoginScreen auth={auth} />;
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-bg/80 backdrop-blur-md border-b border-border">
        <div className="max-w-lg mx-auto px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink">Hand History</h1>
            <p className="text-xs text-gray3">ポーカーのハンド記録</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/settings" className="h-9 w-9 rounded-full bg-surface ring-1 ring-border flex items-center justify-center text-gray2">
              ⚙︎
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-5 py-5 pb-28">
        {error && <div className="rounded-2xl bg-suit-heart/10 text-suit-heart text-sm px-4 py-3 mb-4">{error}</div>}

        {hands === null && !error && <div className="text-center text-gray3 py-16">読み込み中…</div>}

        {hands && hands.length === 0 && (
          <div className="text-center py-20 px-6">
            <div className="text-5xl mb-4">🂠</div>
            <h2 className="text-lg font-semibold text-ink mb-1">まだハンドがありません</h2>
            <p className="text-sm text-gray2 mb-6">下のボタンから、カメラでカードを撮って最初のハンドを記録しましょう。</p>
          </div>
        )}

        {hands && hands.length > 0 && (
          <div className="space-y-2.5">
            {hands.map((h) => (
              <HandRow key={h.id} hand={h} />
            ))}
          </div>
        )}
      </main>

      {/* Floating new-hand button */}
      <div className="fixed bottom-0 inset-x-0 pb-safe pt-3 bg-gradient-to-t from-bg via-bg to-transparent">
        <div className="max-w-lg mx-auto px-5">
          <Link
            href="/hands/new"
            className="flex items-center justify-center gap-2 w-full rounded-2xl bg-gold text-black font-semibold py-4 shadow-lift active:scale-[0.98] transition-transform"
          >
            <span className="text-lg">＋</span> 新しいハンドを記録
          </Link>
        </div>
      </div>
    </div>
  );
}
