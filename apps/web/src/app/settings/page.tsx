"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { ChevronLeftIcon } from "@/components/icons";

export default function SettingsPage() {
  const router = useRouter();
  const auth = useAuth();

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-10 bg-bg/80 backdrop-blur-md border-b border-border">
        <div className="max-w-lg mx-auto px-5 py-4 flex items-center justify-between">
          <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray2 active:scale-95 transition-transform">
            <ChevronLeftIcon size={18} /> 戻る
          </button>
          <h1 className="text-base font-semibold text-ink">設定</h1>
          <div className="w-10" />
        </div>
      </header>

      <main className="max-w-lg mx-auto px-5 py-6 space-y-6">
        <section>
          <h2 className="text-xs font-semibold text-gray3 uppercase tracking-wider mb-2 px-1">アカウント</h2>
          <div className="rounded-2xl bg-white ring-1 ring-border divide-y divide-border shadow-card">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-gray2">メール</span>
              <span className="text-sm text-ink">{auth.session?.user.email ?? "（開発モード）"}</span>
            </div>
            {auth.authAvailable && auth.session && (
              <button
                onClick={async () => {
                  await auth.signOut();
                  router.replace("/");
                }}
                className="w-full text-left px-4 py-3 text-sm text-suit-heart"
              >
                サインアウト
              </button>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold text-gray3 uppercase tracking-wider mb-2 px-1">このアプリについて</h2>
          <div className="rounded-2xl bg-white ring-1 ring-border p-4 shadow-card text-sm text-gray2 space-y-2">
            <p>
              トランプをカメラで撮るだけで、ランクとスートを自動認識してポーカーのハンドを記録・共有できるアプリです（サービス名・アイコンは仮）。
            </p>
            <p className="text-gray3 text-xs">Hand History (仮) — v0.1.0</p>
          </div>
        </section>
      </main>
    </div>
  );
}
