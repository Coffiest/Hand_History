"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { getMockUser, mockLogout, type MockUser } from "@/lib/mockAuth";
import { ChevronLeftIcon, LogoutIcon } from "@/components/icons";
import { VersionTag } from "@/components/AppShell";
import { APP_VERSION } from "@/lib/version";

export default function SettingsPage() {
  const router = useRouter();
  const auth = useAuth();
  const [mockUser, setMockUser] = useState<MockUser | null>(null);

  useEffect(() => setMockUser(getMockUser()), []);

  const email = mockUser?.email ?? auth.session?.user.email ?? "未ログイン";

  const logout = async () => {
    mockLogout();
    if (auth.session) await auth.signOut();
    router.replace("/login");
  };

  return (
    <div className="min-h-dvh bg-bg flex flex-col">
      <header className="sticky top-0 z-10 chrome-bar border-b border-hairline">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray2 active:scale-95 transition-transform">
            <ChevronLeftIcon size={18} /> 戻る
          </button>
          <h1 className="text-base font-semibold text-ink">設定</h1>
          <div className="w-14" />
        </div>
      </header>

      <main className="flex-1 w-full max-w-lg mx-auto px-4 py-6 space-y-6">
        <section>
          <h2 className="text-xs font-semibold text-gray3 uppercase tracking-wider mb-2 px-1">アカウント</h2>
          <div className="glass rounded-3xl divide-y divide-hairline overflow-hidden">
            <div className="px-4 py-3.5 flex items-center justify-between">
              <span className="text-sm text-gray2">メール</span>
              <span className="text-sm text-ink truncate max-w-[200px]">{email}</span>
            </div>
            <div className="px-4 py-3.5 flex items-center justify-between">
              <span className="text-sm text-gray2">認証</span>
              <span className="text-sm text-ink">{auth.session ? "Supabase" : "モック（この端末のみ）"}</span>
            </div>
            <button
              onClick={logout}
              className="w-full px-4 py-3.5 flex items-center gap-2 text-sm font-medium text-suit-heart active:bg-surface transition-colors"
            >
              <LogoutIcon size={18} />
              ログアウト
            </button>
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold text-gray3 uppercase tracking-wider mb-2 px-1">このアプリについて</h2>
          <div className="glass rounded-3xl p-4 text-sm text-gray2 space-y-2 leading-relaxed">
            <p>
              トランプをカメラで撮るだけで、ランクとスートを自動認識してポーカーのハンドを記録・共有できるアプリです（サービス名・アイコンは仮）。
            </p>
            <p className="text-gray3 text-xs tabular-nums">Version {APP_VERSION}</p>
          </div>
        </section>
      </main>

      <footer className="pb-safe pb-4">
        <VersionTag />
      </footer>
    </div>
  );
}
