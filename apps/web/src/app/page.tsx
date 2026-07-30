"use client";

import { AppShell } from "@/components/AppShell";
import { HandListView } from "@/components/HandListView";
import { useRequireLogin } from "@/lib/mockAuth";

export default function HomePage() {
  const ready = useRequireLogin();

  if (!ready) {
    return <div className="min-h-dvh bg-bg flex items-center justify-center text-gray3 text-sm">読み込み中…</div>;
  }

  return (
    <AppShell title="ヒストリー" subtitle="これまでに記録したハンド">
      <HandListView favoritesOnly={false} />
    </AppShell>
  );
}
