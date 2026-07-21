"use client";

import { useState } from "react";
import { ACTION_LABEL, type ActionKind, type RecordedAction, type Street } from "@/lib/handTypes";

// Compact, optional per-street action log editor. Hero-centric but the actor
// label is free-text so villains can be noted loosely. Nothing here is required
// to save a hand.

const HERO_ACTIONS: ActionKind[] = ["fold", "check", "call", "bet", "raise", "allIn"];
const NEEDS_AMOUNT: ActionKind[] = ["bet", "raise", "allIn"];

export function ActionEntryForm({
  street,
  actions,
  onChange,
}: {
  street: Street;
  actions: RecordedAction[];
  onChange: (actions: RecordedAction[]) => void;
}) {
  const [actor, setActor] = useState("Hero");
  const [kind, setKind] = useState<ActionKind>("check");
  const [amount, setAmount] = useState("");

  const add = () => {
    const needsAmount = NEEDS_AMOUNT.includes(kind);
    const toAmount = needsAmount && amount ? Math.trunc(Number(amount)) : null;
    const next: RecordedAction = {
      sequenceNumber: actions.length,
      street,
      kind,
      toAmount: Number.isFinite(toAmount as number) ? toAmount : null,
      actorLabel: actor.trim() || "Hero",
    };
    onChange([...actions, next]);
    setAmount("");
  };

  const remove = (i: number) => {
    onChange(actions.filter((_, idx) => idx !== i).map((a, idx) => ({ ...a, sequenceNumber: idx })));
  };

  return (
    <div className="space-y-3">
      {actions.length > 0 && (
        <div className="space-y-1.5">
          {actions.map((a, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl bg-surface px-3 py-2 text-sm">
              <span className="text-ink">
                <span className="text-gray2">{a.actorLabel}</span> · {ACTION_LABEL[a.kind]}
                {a.toAmount != null ? ` ${a.toAmount}` : ""}
              </span>
              <button onClick={() => remove(i)} className="text-gray3 text-xs px-2">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-white ring-1 ring-border p-3 space-y-3">
        <div className="flex gap-2">
          <input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="Hero"
            className="w-24 rounded-xl bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
          />
          {NEEDS_AMOUNT.includes(kind) && (
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
              placeholder="金額"
              className="flex-1 rounded-xl bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
            />
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {HERO_ACTIONS.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                kind === k ? "bg-ink text-white" : "bg-surface text-gray2 ring-1 ring-border"
              }`}
            >
              {ACTION_LABEL[k]}
            </button>
          ))}
        </div>
        <button onClick={add} className="w-full rounded-xl bg-gold/90 text-black text-sm font-semibold py-2 active:scale-[0.98] transition-transform">
          アクションを追加
        </button>
      </div>
    </div>
  );
}
