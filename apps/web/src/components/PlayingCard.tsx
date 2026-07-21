"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  SUIT_COLOR,
  SUIT_GLYPH,
  rankLabel,
  type CardValue,
  type SuitCode,
} from "@/lib/cards";

// Card renderer. Uses the real card art at `public/cards/{rank}{suit}.png`
// (carried over from Meta-GEO) when present, and falls back to a clean CSS card
// face otherwise — so the app works immediately and swaps to artwork with no
// code change (identical mechanism to Meta-GEO's PlayingCard).

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const DIMS: Record<Size, string> = {
  xs: "h-[34px] w-[24px] text-[9px] rounded-[4px]",
  sm: "h-[52px] w-[37px] text-xs rounded-md",
  md: "h-20 w-14 text-base rounded-lg",
  lg: "h-28 w-20 text-2xl rounded-xl",
  xl: "h-44 w-32 text-4xl rounded-2xl",
};

function CardFace({ card, dims }: { card: CardValue; dims: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const color = SUIT_COLOR[card.suit];

  if (!imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/cards/${card.rank}${card.suit}.png`}
        alt={`${rankLabel(card.rank)}${card.suit}`}
        draggable={false}
        onError={() => setImgFailed(true)}
        className={`${dims} object-contain shadow-card select-none`}
      />
    );
  }

  return (
    <div
      className={`${dims} bg-white shadow-card ring-1 ring-black/10 flex flex-col items-center justify-center leading-none select-none`}
    >
      <span className="font-bold" style={{ color }}>
        {rankLabel(card.rank)}
      </span>
      <span style={{ color }}>{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}

function CardBack({ dims }: { dims: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (!imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/cards/back.png"
        alt=""
        draggable={false}
        onError={() => setImgFailed(true)}
        className={`${dims} object-contain shadow-card select-none`}
      />
    );
  }
  return (
    <div
      className={`${dims} bg-gradient-to-br from-ink to-gray2 shadow-card ring-1 ring-black/30 flex items-center justify-center select-none`}
    >
      <span className="text-white/40">♠</span>
    </div>
  );
}

/** An empty card slot (placeholder before a card is captured). */
function EmptySlot({ dims }: { dims: string }) {
  return (
    <div
      className={`${dims} bg-surface ring-1 ring-dashed ring-border flex items-center justify-center select-none`}
    >
      <span className="text-gray3">?</span>
    </div>
  );
}

export function PlayingCard({
  card,
  size = "md",
  faceDown = false,
  empty = false,
  dealDelay = 0,
}: {
  card?: CardValue | null;
  size?: Size;
  faceDown?: boolean;
  empty?: boolean;
  dealDelay?: number;
}) {
  const dims = DIMS[size];

  let inner;
  if (empty || (!card && !faceDown)) inner = <EmptySlot dims={dims} />;
  else if (faceDown || !card) inner = <CardBack dims={dims} />;
  else inner = <CardFace card={card} dims={dims} />;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: dealDelay, duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      {inner}
    </motion.div>
  );
}

export type { SuitCode };
