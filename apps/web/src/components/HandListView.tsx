"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { PlayingCard } from "./PlayingCard";
import { CardsIcon, StarIcon } from "./icons";
import { cardDisplay } from "@/lib/cards";
import { listHands, setFavorite } from "@/lib/handStore";
import type { StoredHand } from "@/lib/handTypes";

// The gallery floor: hands grouped by day like App Store "Today" sections,
// each hand resting on a glass shelf. Stars burst gold when tapped.

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split("/").map(Number);
  const now = new Date();
  const today = dayKey(now.toISOString());
  const yest = new Date(now.getTime() - 86400000);
  if (key === today) return "今日";
  if (key === dayKey(yest.toISOString())) return "昨日";
  if (y === now.getFullYear()) return `${m}月${d}日`;
  return `${y}年${m}月${d}日`;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
  const [burst, setBurst] = useState(0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3), duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="glass rounded-3xl flex items-center gap-3 p-3.5"
    >
      <Link href={`/hands/${hand.id}`} className="flex items-center gap-3.5 flex-1 min-w-0 active:opacity-70 transition-opacity">
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
          <div className="text-[11px] text-gray2 truncate mt-0.5">
            {timeLabel(hand.createdAt)}
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
        onClick={() => {
          if (!hand.favorite) setBurst((b) => b + 1);
          onToggleFavorite(hand);
        }}
        aria-label={hand.favorite ? "お気に入りから外す" : "お気に入りに追加"}
        className={`relative h-11 w-11 shrink-0 rounded-full flex items-center justify-center active:scale-90 transition-transform ${
          hand.favorite ? "text-gold" : "text-gray3"
        }`}
      >
        <AnimatePresence>
          {burst > 0 && hand.favorite && (
            <motion.span
              key={burst}
              className="absolute inset-1.5 rounded-full bg-gold/30"
              initial={{ scale: 0.4, opacity: 0.9 }}
              animate={{ scale: 1.8, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
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
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[84px] rounded-3xl bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  const visible = favoritesOnly ? hands.filter((h) => h.favorite) : hands;

  if (visible.length === 0) {
    return (
      <div className="text-center py-20 px-6">
        <div className="mx-auto mb-6 h-20 w-20 rounded-3xl glass iris-edge flex items-center justify-center text-gray3">
          {favoritesOnly ? <StarIcon size={30} /> : <CardsIcon size={34} />}
        </div>
        <h2 className="text-lg font-semibold text-ink mb-1.5">
          {favoritesOnly ? "お気に入りはまだありません" : "最初の作品を待っています"}
        </h2>
        <p className="text-sm text-gray2 leading-relaxed max-w-[280px] mx-auto">
          {favoritesOnly
            ? "ハンドの星マークを押すと、ここに集まります。"
            : "下の金色のカメラにカードをかざすと、あなたのハンドがここに並びます。"}
        </p>
      </div>
    );
  }

  // Group into day sections, newest first (list arrives sorted desc).
  const sections: { key: string; hands: StoredHand[] }[] = [];
  for (const h of visible) {
    const key = dayKey(h.createdAt);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.hands.push(h);
    else sections.push({ key, hands: [h] });
  }

  let flat = 0;
  return (
    <div className="space-y-7">
      {sections.map((section) => (
        <section key={section.key}>
          <h2 className="text-[20px] font-bold text-ink tracking-tight mb-3">{dayLabel(section.key)}</h2>
          <div className="space-y-3">
            {section.hands.map((h) => (
              <HandRow key={h.id} hand={h} index={flat++} onToggleFavorite={toggle} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
