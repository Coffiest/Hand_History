import type { Metadata } from "next";
import Link from "next/link";
import { getHandByShareToken } from "@/lib/handRepo";
import { HandReplay } from "@/components/HandReplay";
import { VersionTag } from "@/components/AppShell";
import { CardsIcon } from "@/components/icons";
import { cardDisplay } from "@/lib/cards";

export const runtime = "nodejs";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const hand = await getHandByShareToken(token);
  const hole = hand?.cards.filter((c) => c.role === "hole").sort((a, b) => a.position - b.position) ?? [];
  const title = hole.length ? `${hole.map(cardDisplay).join(" ")} | Hand History` : "Hand History";
  return {
    title,
    openGraph: {
      title,
      description: "ポーカーのハンドヒストリー",
      images: [`/api/share/${token}/image`],
    },
    twitter: { card: "summary_large_image", title, images: [`/api/share/${token}/image`] },
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hand = await getHandByShareToken(token);

  if (!hand) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-5 p-8 text-center bg-bg">
        <div className="h-16 w-16 rounded-3xl glass iris-edge flex items-center justify-center text-gray3">
          <CardsIcon size={30} />
        </div>
        <div className="text-gray2">共有されたハンドが見つかりませんでした。</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-bg relative overflow-hidden">
      <div className="iris-bloom h-72 w-72 -top-20 -right-16" aria-hidden="true" />
      <header className="glass relative" style={{ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none" }}>
        <div className="max-w-lg mx-auto px-5 py-4 text-center">
          <h1 className="text-base font-semibold text-ink">Hand History</h1>
          <p className="text-xs text-gray3">共有されたハンド</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-5 py-6 pb-16 space-y-6">
        <HandReplay hand={hand} />
        <Link
          href="/"
          className="block text-center rounded-2xl bg-gold text-black font-semibold py-3.5 shadow-gold active:scale-[0.98] transition-transform"
        >
          自分もハンドを記録する
        </Link>

        <VersionTag />
      </main>
    </div>
  );
}
