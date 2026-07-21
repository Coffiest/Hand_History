"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { PlayingCard } from "./PlayingCard";
import { CardsIcon, StarIcon } from "./icons";
import { cardDisplay } from "@/lib/cards";
import { listHands, setFavorite } from "@/lib/handStore";
import type { StoredHand } from "@/lib/handTypes";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function HandRow({
  hand,
  index,
  onToggleFavorite,
}: {
  hand: StoredHand;
  index: number;
  onToggleFavorite: (hand: StoredHand) => void;
}) {
  const hole = hand.cards.filter((c) => c.role === "hole").sort((a, b) => a.position - b.position);
  const board = hand.cards.filter((c) => c.role === "board").sort((a, b) => a.position - b.position);
  const result = hand.resultAmount;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3), duration: 0.25 }}
      className="flex items-center gap-3 rounded-2xl bg-white ring-1 ring-border p-3 shadow-card"
    >
      <Link href={`/hands/${hand.id}`} className="flex items-center gap-3 flex-1 min-w-0 active:opacity-70 transition-opacity">
        <div className="flex gap-1 shrink-0">
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
          <div className="text-[15px] font-semibold text-ink truncate">
            {hand.title || (hole.length ? hole.map(cardDisplay).join(" ") : "ハンド")}
          </div>
          <div className="text-[11px] text-gray3 truncate">
            {formatDate(hand.createdAt)}
            {hand.heroPosition ? ` · ${hand.heroPosition}` : ""}
            {board.length ? ` · ボード${board.length}枚` : ""}
          </div>
        </div>
        {result != null && (
          <div className={`text-sm font-bold tabular-nums shrink-0 ${result >= 0 ? "text-suit-club" : "text-suit-heart"}`}>
            {result >= 0 ? "+" : ""}
            {result}
          </div>
        )}
      </Link>
      <button
        onClick={() => onToggleFavorite(hand)}
        aria-label={hand.favorite ? "お気に入りから外す" : "お気に入りに追加"}
        className={`h-11 w-11 shrink-0 rounded-full flex items-center justify-center active:scale-90 transition-transform ${
          hand.favorite ? "text-gold" : "text-gray3"
        }`}
      >
        <StarIcon size={20} filled={hand.favorite} />
      </button>
    </motion.div>
  );
}

export function HandListView({ favoritesOnly }: { favoritesOnly: boolean }) {
  const [hands, setHands] = useState<StoredHand[] | null>(null);

  useEffect(() => {
    listHands().then(setHands);
  }, []);

  const toggle = async (hand: StoredHand) => {
    const next = !hand.favorite;
    setHands((prev) => prev?.map((h) => (h.id === hand.id ? { ...h, favorite: next } : h)) ?? null);
    await setFavorite(hand.id, next);
  };

  if (hands === null) {
    return (
      <div className="space-y-2.5" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[76px] rounded-2xl bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  const visible = favoritesOnly ? hands.filter((h) => h.favorite) : hands;

  if (visible.length === 0) {
    return (
      <div className="text-center py-16 px-6">
        <div className="mx-auto mb-5 h-16 w-16 rounded-2xl bg-surface ring-1 ring-border flex items-center justify-center text-gray3">
          {favoritesOnly ? <StarIcon size={28} /> : <CardsIcon size={30} />}
        </div>
        <h2 className="text-lg font-semibold text-ink mb-1">
          {favoritesOnly ? "お気に入りはまだありません" : "まだハンドがありません"}
        </h2>
        <p className="text-sm text-gray2 leading-relaxed max-w-[280px] mx-auto">
          {favoritesOnly
            ? "ハンドの星マークを押すと、ここに集まります。"
            : "下の金色のカメラボタンから、カードを撮って最初のハンドを記録しましょう。"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {visible.map((h, i) => (
        <HandRow key={h.id} hand={h} index={i} onToggleFavorite={toggle} />
      ))}
    </div>
  );
}
