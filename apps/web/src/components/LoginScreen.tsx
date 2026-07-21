"use client";

import { useState } from "react";
import type { AuthState } from "@/lib/useAuth";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6">
      <path fill="#EA4335" d="M12 5.04c1.62 0 3.06.56 4.2 1.66l3.12-3.12C17.4 1.8 14.9.75 12 .75 7.55.75 3.73 3.3 1.9 7.02l3.66 2.84C6.44 7.1 8.99 5.04 12 5.04Z" />
      <path fill="#4285F4" d="M23.25 12.26c0-.8-.07-1.57-.2-2.31H12v4.51h6.33c-.28 1.44-1.1 2.66-2.34 3.48l3.58 2.78c2.09-1.94 3.68-4.8 3.68-8.46Z" />
      <path fill="#FBBC05" d="M5.56 14.14a6.9 6.9 0 0 1 0-4.28L1.9 7.02a11.24 11.24 0 0 0 0 9.96l3.66-2.84Z" />
      <path fill="#34A853" d="M12 23.25c3.04 0 5.6-1 7.46-2.72l-3.58-2.78c-.99.67-2.28 1.06-3.88 1.06-3.01 0-5.56-2.06-6.44-4.82L1.9 16.98c1.83 3.72 5.65 6.27 10.1 6.27Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white">
      <path d="M16.98 12.83c.03 3.02 2.65 4.03 2.68 4.04-.02.07-.42 1.44-1.38 2.85-.83 1.22-1.7 2.43-3.06 2.46-1.34.02-1.77-.8-3.3-.8-1.53 0-2 .77-3.27.82-1.31.05-2.31-1.32-3.15-2.53C3.78 17.18 2.47 12.66 4.23 9.6c.88-1.53 2.44-2.5 4.14-2.52 1.29-.02 2.51.87 3.3.87.79 0 2.27-1.07 3.83-.92.65.03 2.48.26 3.66 1.99-.1.06-2.19 1.28-2.18 3.81ZM14.46 5.4c.7-.85 1.17-2.03 1.04-3.2-1.01.04-2.22.67-2.94 1.51-.65.75-1.21 1.95-1.06 3.1 1.12.09 2.26-.57 2.96-1.41Z" />
    </svg>
  );
}

// Login / sign-up. Rounded social buttons (Apple/Google) + email magic link.
// Reskinned from Meta-GEO's LoginScreen to the warm-white / gold design tokens.
export function LoginScreen({ auth }: { auth: AuthState }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const handleSendLink = async () => {
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    const { error } = await auth.sendMagicLink(email.trim());
    setSending(false);
    if (error) setError(error);
    else setSent(true);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-8 bg-bg">
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center gap-1.5">
          <span className="rounded-lg bg-white shadow-card px-2 py-1 text-lg font-black text-ink">A♠</span>
          <span className="rounded-lg bg-white shadow-card px-2 py-1 text-lg font-black text-suit-heart">K♥</span>
        </div>
        <div className="text-[12px] tracking-[0.3em] text-gold-dark font-semibold">HAND HISTORY (仮)</div>
        <h1 className="text-2xl font-semibold text-ink">ログイン / 新規登録</h1>
        <p className="text-sm text-gray2 max-w-xs mx-auto">
          トランプをカメラで撮るだけで、ポーカーのハンドを自動で記録・共有できます。
        </p>
      </div>

      <div className="w-full max-w-xs space-y-4">
        {!auth.authAvailable && (
          <div className="rounded-2xl bg-gold/10 text-gold-dark text-xs px-4 py-3 text-center">
            認証は未設定です（開発モード）。下の「メールで続ける」はデモ用に無効です。
          </div>
        )}

        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => auth.signInWithApple()}
            aria-label="Appleでログイン"
            className="h-14 w-14 rounded-full bg-black ring-1 ring-black/10 flex items-center justify-center shadow-card active:scale-90 transition-transform"
          >
            <AppleIcon />
          </button>
          <button
            onClick={() => auth.signInWithGoogle()}
            aria-label="Googleでログイン"
            className="h-14 w-14 rounded-full bg-white ring-1 ring-border flex items-center justify-center shadow-card active:scale-90 transition-transform"
          >
            <GoogleIcon />
          </button>
        </div>

        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] text-gray3">または メールで続ける</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {sent ? (
          <div className="rounded-2xl bg-white shadow-card ring-1 ring-border px-4 py-4 text-sm text-gray2 text-center">
            <span className="font-medium text-ink">{email}</span> 宛にログインリンクを送りました。メール内のリンクを開いてください。
          </div>
        ) : (
          <>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendLink()}
              type="email"
              placeholder="メールアドレス"
              className="w-full rounded-2xl bg-white ring-1 ring-border px-4 py-3 text-sm text-ink placeholder:text-gray3 focus:outline-none focus:ring-2 focus:ring-gold"
            />
            {error && <p className="text-xs text-suit-heart px-1">{error}</p>}
            <button
              onClick={handleSendLink}
              disabled={sending || !email.trim() || !auth.authAvailable}
              className="w-full rounded-2xl bg-gold text-black font-semibold py-3 shadow-card active:scale-[0.98] transition-transform disabled:opacity-40"
            >
              {sending ? "送信中…" : "ログインリンクを送る"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
