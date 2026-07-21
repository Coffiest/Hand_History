"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { PlayingCard } from "@/components/PlayingCard";
import { VersionTag } from "@/components/AppShell";
import { getMockUser, mockLogin } from "@/lib/mockAuth";
import { useAuth } from "@/lib/useAuth";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#EA4335" d="M12 5.04c1.62 0 3.06.56 4.2 1.66l3.12-3.12C17.4 1.8 14.9.75 12 .75 7.55.75 3.73 3.3 1.9 7.02l3.66 2.84C6.44 7.1 8.99 5.04 12 5.04Z" />
      <path fill="#4285F4" d="M23.25 12.26c0-.8-.07-1.57-.2-2.31H12v4.51h6.33c-.28 1.44-1.1 2.66-2.34 3.48l3.58 2.78c2.09-1.94 3.68-4.8 3.68-8.46Z" />
      <path fill="#FBBC05" d="M5.56 14.14a6.9 6.9 0 0 1 0-4.28L1.9 7.02a11.24 11.24 0 0 0 0 9.96l3.66-2.84Z" />
      <path fill="#34A853" d="M12 23.25c3.04 0 5.6-1 7.46-2.72l-3.58-2.78c-.99.67-2.28 1.06-3.88 1.06-3.01 0-5.56-2.06-6.44-4.82L1.9 16.98c1.83 3.72 5.65 6.27 10.1 6.27Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden="true">
      <path d="M16.98 12.83c.03 3.02 2.65 4.03 2.68 4.04-.02.07-.42 1.44-1.38 2.85-.83 1.22-1.7 2.43-3.06 2.46-1.34.02-1.77-.8-3.3-.8-1.53 0-2 .77-3.27.82-1.31.05-2.31-1.32-3.15-2.53C3.78 17.18 2.47 12.66 4.23 9.6c.88-1.53 2.44-2.5 4.14-2.52 1.29-.02 2.51.87 3.3.87.79 0 2.27-1.07 3.83-.92.65.03 2.48.26 3.66 1.99-.1.06-2.19 1.28-2.18 3.81ZM14.46 5.4c.7-.85 1.17-2.03 1.04-3.2-1.01.04-2.22.67-2.94 1.51-.65.75-1.21 1.95-1.06 3.1 1.12.09 2.26-.57 2.96-1.41Z" />
    </svg>
  );
}

// Login / sign-up. MOCK phase: any input signs you in (session lives on this
// device). Real Supabase OAuth is used automatically once configured.
export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getMockUser() || auth.session) router.replace("/");
  }, [auth.session, router]);

  const enter = (identity: string) => {
    setBusy(true);
    mockLogin(identity);
    router.replace("/");
  };

  const social = async (provider: "apple" | "google") => {
    if (auth.authAvailable) {
      if (provider === "apple") await auth.signInWithApple();
      else await auth.signInWithGoogle();
      return;
    }
    enter(`${provider}@mock.local`);
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        {/* Hero: fanned cards over a soft gold glow */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative mb-8"
        >
          <div className="absolute inset-0 -m-8 rounded-full bg-gold/15 blur-2xl" aria-hidden="true" />
          <div className="relative flex items-end justify-center">
            <div className="rotate-[-14deg] translate-x-3 translate-y-1">
              <PlayingCard card={{ rank: 1, suit: "s" }} size="lg" />
            </div>
            <div className="z-10">
              <PlayingCard card={{ rank: 13, suit: "h" }} size="lg" dealDelay={0.08} />
            </div>
            <div className="rotate-[14deg] -translate-x-3 translate-y-1">
              <PlayingCard card={{ rank: 12, suit: "d" }} size="lg" dealDelay={0.16} />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.45 }}
          className="text-center mb-8"
        >
          <p className="text-[11px] font-semibold tracking-[0.3em] text-gold-dark uppercase mb-2">
            Poker Camera Log
          </p>
          <h1 className="text-[28px] font-bold text-ink tracking-tight leading-tight">
            Hand History <span className="text-gray3 text-lg font-medium">(仮)</span>
          </h1>
          <p className="mt-2 text-sm text-gray2 max-w-[260px] mx-auto leading-relaxed">
            トランプを撮るだけで、ハンドを自動で記録・共有。
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.45 }}
          className="w-full max-w-xs space-y-3"
        >
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            placeholder="メールアドレス"
            className="w-full h-12 rounded-2xl bg-white ring-1 ring-border px-4 text-[15px] text-ink placeholder:text-gray3 focus:outline-none focus:ring-2 focus:ring-gold"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enter(email)}
            type="password"
            autoComplete="current-password"
            placeholder="パスワード"
            className="w-full h-12 rounded-2xl bg-white ring-1 ring-border px-4 text-[15px] text-ink placeholder:text-gray3 focus:outline-none focus:ring-2 focus:ring-gold"
          />
          <button
            onClick={() => enter(email)}
            disabled={busy}
            className="w-full h-12 rounded-2xl bg-gold text-black font-semibold shadow-card active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {busy ? "ログイン中…" : "ログイン / 新規登録"}
          </button>

          <div className="flex items-center gap-3 py-1.5">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] text-gray3">または</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => social("apple")}
              className="h-12 rounded-2xl bg-black text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-card active:scale-[0.97] transition-transform"
            >
              <AppleIcon /> Apple
            </button>
            <button
              onClick={() => social("google")}
              className="h-12 rounded-2xl bg-white ring-1 ring-border text-ink text-sm font-semibold flex items-center justify-center gap-2 shadow-card active:scale-[0.97] transition-transform"
            >
              <GoogleIcon /> Google
            </button>
          </div>

          <p className="pt-2 text-center text-[11px] text-gray3 leading-relaxed">
            現在はモック認証です。どの入力でもログインできます。
          </p>
        </motion.div>
      </main>

      <footer className="pb-safe pb-6">
        <VersionTag />
      </footer>
    </div>
  );
}
