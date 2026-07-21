"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CaptureFlow } from "@/components/CaptureFlow";
import { ActionEntryForm } from "@/components/ActionEntryForm";
import { PlayingCard } from "@/components/PlayingCard";
import type { ConfirmCard } from "@/components/CardConfirmSheet";
import { createHand } from "@/lib/apiClient";
import {
  STREETS,
  STREET_LABEL_JA,
  type HandPayload,
  type RecordedAction,
  type RecordedCard,
  type Street,
} from "@/lib/handTypes";

const POSITIONS = ["BTN", "SB", "BB", "UTG", "UTG1", "UTG2", "LJ", "HJ", "CO"];

type CaptureTarget = null | { kind: "hole" } | { kind: "board" };

function toRecordedCards(
  cards: ConfirmCard[],
  role: "hole" | "board",
  boardStreetForIndex: (i: number) => Street | null,
): RecordedCard[] {
  return cards.map((c, i) => ({
    role,
    boardStreet: role === "board" ? boardStreetForIndex(i) : null,
    position: i,
    rank: c.rank,
    suit: c.suit,
    rankConfidence: c.rankConfidence,
    suitConfidence: c.suitConfidence,
    source: c.source,
  }));
}

// Board street by dealt order: first 3 = flop, 4th = turn, 5th = river.
function boardStreetForPosition(i: number): Street | null {
  if (i < 3) return "flop";
  if (i === 3) return "turn";
  if (i === 4) return "river";
  return null;
}

export default function NewHandPage() {
  const router = useRouter();

  const [holeCards, setHoleCards] = useState<RecordedCard[]>([]);
  const [boardCards, setBoardCards] = useState<RecordedCard[]>([]);
  const [capture, setCapture] = useState<CaptureTarget>(null);

  const [heroPosition, setHeroPosition] = useState<string | null>(null);
  const [numPlayers, setNumPlayers] = useState<number | null>(null);
  const [smallBlind, setSmallBlind] = useState("");
  const [bigBlind, setBigBlind] = useState("");
  const [actionsByStreet, setActionsByStreet] = useState<Record<Street, RecordedAction[]>>({
    preflop: [],
    flop: [],
    turn: [],
    river: [],
  });
  const [openStreet, setOpenStreet] = useState<Street | null>(null);
  const [potTotal, setPotTotal] = useState("");
  const [resultAmount, setResultAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onHoleDone = (cards: ConfirmCard[]) => {
    setHoleCards(toRecordedCards(cards, "hole", () => null));
    setCapture(null);
  };

  const onBoardDone = (cards: ConfirmCard[]) => {
    setBoardCards(toRecordedCards(cards, "board", boardStreetForPosition));
    setCapture(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const num = (v: string) => (v.trim() ? Math.trunc(Number(v)) : null);
    const payload: HandPayload = {
      title: null,
      heroPosition,
      numPlayers,
      smallBlind: num(smallBlind),
      bigBlind: num(bigBlind),
      potTotal: num(potTotal),
      resultAmount: resultAmount.trim() ? Math.trunc(Number(resultAmount)) : null,
      wonByFold: null,
      notes: notes.trim() || null,
      cards: [...holeCards, ...boardCards],
      actions: STREETS.flatMap((s) => actionsByStreet[s]).map((a, i) => ({ ...a, sequenceNumber: i })),
    };
    try {
      const hand = await createHand(payload);
      router.replace(`/hands/${hand.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      setSaving(false);
    }
  };

  // Active capture overlay.
  if (capture?.kind === "hole") {
    return (
      <CaptureFlow
        title="ホールカード"
        hint="自分の2枚をまとめて撮影"
        expectedCount={2}
        onDone={onHoleDone}
        onCancel={() => setCapture(null)}
      />
    );
  }
  if (capture?.kind === "board") {
    return (
      <CaptureFlow
        title="ボード"
        hint="場のカード（3〜5枚）をまとめて撮影"
        onDone={onBoardDone}
        onCancel={() => setCapture(null)}
      />
    );
  }

  const boardByStreet = (street: Street) =>
    boardCards.filter((c) => c.boardStreet === street).sort((a, b) => a.position - b.position);

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 bg-bg/80 backdrop-blur-md border-b border-border">
        <div className="max-w-lg mx-auto px-5 py-4 flex items-center justify-between">
          <button onClick={() => router.back()} className="text-sm text-gray2">
            ← 戻る
          </button>
          <h1 className="text-base font-semibold text-ink">新しいハンド</h1>
          <button
            onClick={save}
            disabled={saving || holeCards.length === 0}
            className="text-sm font-semibold text-gold-dark disabled:text-gray3"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-5 py-5 pb-16 space-y-6">
        {error && <div className="rounded-2xl bg-suit-heart/10 text-suit-heart text-sm px-4 py-3">{error}</div>}

        {/* Hole cards */}
        <section>
          <h2 className="text-sm font-semibold text-gray2 mb-2">ホールカード</h2>
          <div className="rounded-2xl bg-white ring-1 ring-border p-4 flex items-center gap-4 shadow-card">
            <div className="flex gap-2">
              {holeCards.length > 0 ? (
                holeCards.map((c, i) => <PlayingCard key={i} card={c} size="lg" dealDelay={i * 0.05} />)
              ) : (
                <>
                  <PlayingCard empty size="lg" />
                  <PlayingCard empty size="lg" />
                </>
              )}
            </div>
            <button
              onClick={() => setCapture({ kind: "hole" })}
              className="ml-auto rounded-2xl bg-gold text-black text-sm font-semibold px-4 py-2.5 active:scale-95 transition-transform"
            >
              {holeCards.length ? "撮り直す" : "📷 撮影"}
            </button>
          </div>
        </section>

        {/* Board */}
        <section>
          <h2 className="text-sm font-semibold text-gray2 mb-2">ボード</h2>
          <div className="rounded-2xl bg-white ring-1 ring-border p-4 shadow-card">
            <div className="flex items-center gap-2 flex-wrap min-h-[80px]">
              {boardCards.length > 0 ? (
                boardCards.map((c, i) => <PlayingCard key={i} card={c} size="md" dealDelay={i * 0.05} />)
              ) : (
                <span className="text-sm text-gray3">まだ撮影していません（任意）</span>
              )}
            </div>
            <button
              onClick={() => setCapture({ kind: "board" })}
              className="mt-3 w-full rounded-2xl bg-surface ring-1 ring-border text-ink text-sm font-semibold py-2.5 active:scale-[0.98] transition-transform"
            >
              {boardCards.length ? "撮り直す" : "📷 ボードを撮影"}
            </button>
          </div>
        </section>

        {/* Position & blinds (optional) */}
        <section>
          <h2 className="text-sm font-semibold text-gray2 mb-2">ポジション・ブラインド（任意）</h2>
          <div className="rounded-2xl bg-white ring-1 ring-border p-4 space-y-3 shadow-card">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  onClick={() => setHeroPosition(heroPosition === p ? null : p)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                    heroPosition === p ? "bg-ink text-white" : "bg-surface text-gray2 ring-1 ring-border"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={smallBlind}
                onChange={(e) => setSmallBlind(e.target.value)}
                inputMode="numeric"
                placeholder="SB"
                className="flex-1 rounded-xl bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              />
              <input
                value={bigBlind}
                onChange={(e) => setBigBlind(e.target.value)}
                inputMode="numeric"
                placeholder="BB"
                className="flex-1 rounded-xl bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              />
              <select
                value={numPlayers ?? ""}
                onChange={(e) => setNumPlayers(e.target.value ? Number(e.target.value) : null)}
                className="w-24 rounded-xl bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold text-gray2"
              >
                <option value="">人数</option>
                {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <option key={n} value={n}>
                    {n}人
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Actions per street (optional, collapsible) */}
        <section>
          <h2 className="text-sm font-semibold text-gray2 mb-2">アクション（任意）</h2>
          <div className="space-y-2">
            {STREETS.map((street) => {
              const board = boardByStreet(street);
              const count = actionsByStreet[street].length;
              const open = openStreet === street;
              return (
                <div key={street} className="rounded-2xl bg-white ring-1 ring-border overflow-hidden shadow-card">
                  <button
                    onClick={() => setOpenStreet(open ? null : street)}
                    className="w-full flex items-center justify-between px-4 py-3"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{STREET_LABEL_JA[street]}</span>
                      {board.length > 0 && (
                        <span className="flex gap-1">
                          {board.map((c, i) => (
                            <PlayingCard key={i} card={c} size="xs" />
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray3">
                      {count > 0 ? `${count}件` : ""} {open ? "▲" : "▼"}
                    </span>
                  </button>
                  <AnimatePresence>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="px-4 pb-4"
                      >
                        <ActionEntryForm
                          street={street}
                          actions={actionsByStreet[street]}
                          onChange={(a) => setActionsByStreet((prev) => ({ ...prev, [street]: a }))}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </section>

        {/* Result (optional) */}
        <section>
          <h2 className="text-sm font-semibold text-gray2 mb-2">結果・メモ（任意）</h2>
          <div className="rounded-2xl bg-white ring-1 ring-border p-4 space-y-3 shadow-card">
            <div className="flex gap-2">
              <input
                value={potTotal}
                onChange={(e) => setPotTotal(e.target.value)}
                inputMode="numeric"
                placeholder="ポット"
                className="flex-1 rounded-xl bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              />
              <input
                value={resultAmount}
                onChange={(e) => setResultAmount(e.target.value)}
                inputMode="numeric"
                placeholder="収支 (+/-)"
                className="flex-1 rounded-xl bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="メモ"
              rows={2}
              className="w-full rounded-xl bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold resize-none"
            />
          </div>
        </section>

        <button
          onClick={save}
          disabled={saving || holeCards.length === 0}
          className="w-full rounded-2xl bg-gold text-black font-semibold py-4 shadow-lift active:scale-[0.98] transition-transform disabled:opacity-40"
        >
          {saving ? "保存中…" : "ハンドを保存"}
        </button>
      </main>
    </div>
  );
}
