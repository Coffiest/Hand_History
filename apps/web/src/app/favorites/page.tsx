"use client";

import { AppShell } from "@/components/AppShell";
import { HandListView } from "@/components/HandListView";
import { useRequireLogin } from "@/lib/mockAuth";

export default function FavoritesPage() {
  const ready = useRequireLogin();

  if (!ready) {
    return <div className="min-h-dvh bg-bg flex items-center justify-center text-gray3 text-sm">読み込み中…</div>;
  }

  return (
    <AppShell title="お気に入り" subtitle="星を付けたハンド">
      <HandListView favoritesOnly />
    </AppShell>
  );
}
