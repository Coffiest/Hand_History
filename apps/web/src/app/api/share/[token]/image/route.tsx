import { ImageResponse } from "next/og";
import { getHandByShareToken } from "@/lib/handRepo";
import { rankLabel, SUIT_GLYPH, SUIT_COLOR, type SuitCode } from "@/lib/cards";
import { STREETS, type Street } from "@/lib/handTypes";

export const runtime = "nodejs";

// Dynamically renders a shareable PNG from the recognised card data (never from
// the original photo — the user's raw hand photo is never stored server-side).

function Card({ rank, suit, w = 92 }: { rank: number; suit: SuitCode; w?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: w,
        height: w * 1.4,
        background: "white",
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        color: SUIT_COLOR[suit],
      }}
    >
      <div style={{ fontSize: w * 0.5, fontWeight: 800, lineHeight: 1 }}>{rankLabel(rank)}</div>
      <div style={{ fontSize: w * 0.5, lineHeight: 1 }}>{SUIT_GLYPH[suit]}</div>
    </div>
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hand = await getHandByShareToken(token);

  if (!hand) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1D1D1F", color: "white", fontSize: 40 }}>
          Hand not found
        </div>
      ),
      { width: 1200, height: 630 },
    );
  }

  const hole = hand.cards.filter((c) => c.role === "hole").sort((a, b) => a.position - b.position);
  const board = hand.cards
    .filter((c) => c.role === "board")
    .sort((a, b) => {
      const order = (s: Street | null) => (s ? STREETS.indexOf(s) : 9) * 10;
      return order(a.boardStreet) + a.position - (order(b.boardStreet) + b.position);
    });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #0f5132 0%, #14663f 100%)",
          padding: 56,
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 34, fontWeight: 800 }}>Hand History</div>
          <div style={{ fontSize: 22, color: "rgba(255,255,255,0.7)" }}>
            {hand.heroPosition ?? ""}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 30, gap: 26 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 20, letterSpacing: 4, color: "rgba(255,255,255,0.75)" }}>BOARD</div>
            <div style={{ display: "flex", gap: 12 }}>
              {board.length > 0 ? (
                board.map((c, i) => <Card key={i} rank={c.rank} suit={c.suit as SuitCode} w={96} />)
              ) : (
                <div style={{ fontSize: 24, color: "rgba(255,255,255,0.6)" }}>preflop</div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 8 }}>
            <div style={{ fontSize: 20, letterSpacing: 4, color: "#F2A900" }}>HERO</div>
            <div style={{ display: "flex", gap: 12 }}>
              {hole.map((c, i) => <Card key={i} rank={c.rank} suit={c.suit as SuitCode} w={110} />)}
            </div>
          </div>
        </div>

        {hand.resultAmount != null && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: "auto", fontSize: 40, fontWeight: 800, color: hand.resultAmount >= 0 ? "#7CFFB2" : "#FF9A9A" }}>
            {hand.resultAmount >= 0 ? "+" : ""}
            {hand.resultAmount}
          </div>
        )}
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
