"use client";

import { AppShell } from "@/components/AppShell";
import { HandListView } from "@/components/HandListView";
import { useRequireLogin } from "@/lib/mockAuth";

export default function FavoritesPage() {
  const ready = useRequireLogin();

  if (!ready) {
    return <div className="min-h-screen bg-bg flex items-center justify-center text-gray3 text-sm">読み込み中…</div>;
  }

  return (
    <AppShell>
      <div className="flex items-baseline justify-between mb-3 px-1">
        <h1 className="text-[22px] font-bold text-ink tracking-tight">お気に入り</h1>
        <span className="text-xs text-gray3">星を付けたハンド</span>
      </div>
      <HandListView favoritesOnly />
    </AppShell>
  );
}
