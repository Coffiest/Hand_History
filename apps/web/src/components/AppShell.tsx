"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  CameraIcon,
  CloseIcon,
  HomeIcon,
  LogoutIcon,
  MenuIcon,
  PlusIcon,
  SettingsIcon,
  StarIcon,
} from "./icons";
import { APP_VERSION } from "@/lib/version";
import { getMockUser, mockLogout } from "@/lib/mockAuth";
import { useAuth } from "@/lib/useAuth";

// White Cube shell. App Store grammar: a large title that condenses into a
// compact glass bar as you scroll, and a floating liquid-glass tab bar with
// the gold camera button at its centre. The drawer is a glass panel sliding
// over the gallery.

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 select-none">
      <span className="flex -space-x-1.5" aria-hidden="true">
        <span className="rotate-[-8deg] rounded-md bg-white shadow-card ring-1 ring-border px-1.5 py-0.5 text-[12px] font-black text-ink leading-none">
          A♠
        </span>
        <span className="rotate-[8deg] rounded-md bg-white shadow-card ring-1 ring-border px-1.5 py-0.5 text-[12px] font-black text-suit-heart leading-none">
          K♥
        </span>
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[15px] font-bold text-ink tracking-tight">Hand History</span>
          <span className="block text-[9px] font-semibold tracking-[0.24em] text-gold-dark uppercase">
            Poker Camera Log
          </span>
        </span>
      )}
    </Link>
  );
}

export function VersionTag({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-[10px] text-gray3 tabular-nums ${className}`}>
      Hand History (仮) v{APP_VERSION}
    </p>
  );
}

function DrawerLink({
  href,
  icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-[15px] font-medium text-ink active:bg-surface transition-colors"
    >
      <span className="text-gray2">{icon}</span>
      {label}
    </Link>
  );
}

export function AppShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  /** Large title in the App Store style; condenses into the bar on scroll. */
  title?: string;
  subtitle?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [condensed, setCondensed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();

  useEffect(() => {
    const onScroll = () => setCondensed(window.scrollY > 34);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const close = () => setMenuOpen(false);

  const logout = async () => {
    mockLogout();
    if (auth.session) await auth.signOut();
    close();
    router.replace("/login");
  };

  const navItem = (href: string, icon: React.ReactNode, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`relative flex flex-col items-center justify-center gap-0.5 py-2 min-h-[52px] min-w-[64px] transition-colors ${
          active ? "text-ink" : "text-gray3"
        }`}
      >
        {icon}
        <span className="text-[10px] font-semibold">{label}</span>
        {active && (
          <motion.span
            layoutId="tab-dot"
            className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-gold"
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
          />
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-dvh bg-bg flex flex-col">
      {/* Compact glass bar: transparent over the large title, glass on scroll */}
      <header
        className={`sticky top-0 z-40 transition-shadow duration-300 ${
          condensed ? "glass" : "bg-transparent border-b border-transparent"
        }`}
        style={{ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none" }}
      >
        <div className="max-w-lg mx-auto px-5 h-14 relative flex items-center justify-between">
          <Logo compact={condensed} />
          {/* Condensed title docks dead-centre, App Store style. */}
          <AnimatePresence>
            {condensed && title && (
              <motion.span
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className="absolute left-1/2 -translate-x-1/2 text-[15px] font-semibold text-ink pointer-events-none"
              >
                {title}
              </motion.span>
            )}
          </AnimatePresence>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="メニュー"
            className="h-11 w-11 rounded-full flex items-center justify-center text-ink active:scale-95 transition-transform"
          >
            <MenuIcon size={22} />
          </button>
        </div>
      </header>

      {/* Large title (the gallery wall label) */}
      {title && (
        <div className="max-w-lg mx-auto w-full px-5 pt-1 pb-2">
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="text-[34px] leading-tight font-bold text-ink tracking-tight"
          >
            {title}
          </motion.h1>
          {subtitle && <p className="text-[13px] text-gray2 mt-0.5">{subtitle}</p>}
        </div>
      )}

      {/* Content */}
      <main className="flex-1 w-full max-w-lg mx-auto px-5 pt-2 pb-40">{children}</main>

      {/* Floating liquid-glass tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-40 pointer-events-none">
        <div className="max-w-lg mx-auto px-5 pb-safe">
          <div className="pointer-events-auto glass-strong iris-edge rounded-[28px] mb-1 px-4 grid grid-cols-3 items-end">
            {navItem("/", <HomeIcon size={22} />, "ホーム")}
            <div className="flex flex-col items-center -mt-8 pb-1.5">
              <Link
                href="/hands/new"
                aria-label="カメラで記録"
                className="h-[64px] w-[64px] rounded-full bg-gold text-black shadow-gold ring-4 ring-white flex items-center justify-center active:scale-90 transition-transform"
              >
                <CameraIcon size={28} />
              </Link>
              <span className="mt-1 text-[10px] font-semibold text-gold-dark">記録</span>
            </div>
            {navItem("/favorites", <StarIcon size={22} />, "お気に入り")}
          </div>
          <VersionTag className="pb-1.5 pt-0.5" />
        </div>
      </nav>

      {/* Glass drawer */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.button
              aria-label="メニューを閉じる"
              className="fixed inset-0 z-50 bg-ink/35"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
            />
            <motion.aside
              className="fixed top-0 right-0 bottom-0 z-50 w-[78%] max-w-xs glass-strong flex flex-col"
              style={{ borderRadius: "24px 0 0 24px" }}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
            >
              <div className="h-14 px-4 flex items-center justify-between border-b border-hairline">
                <span className="text-sm font-semibold text-ink">メニュー</span>
                <button
                  onClick={close}
                  aria-label="閉じる"
                  className="h-11 w-11 rounded-full flex items-center justify-center text-gray2 active:scale-95 transition-transform"
                >
                  <CloseIcon size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                <DrawerLink href="/" icon={<HomeIcon size={20} />} label="ホーム" onNavigate={close} />
                <DrawerLink href="/hands/new" icon={<PlusIcon size={20} />} label="新しいハンドを記録" onNavigate={close} />
                <DrawerLink href="/favorites" icon={<StarIcon size={20} />} label="お気に入り" onNavigate={close} />
                <DrawerLink href="/settings" icon={<SettingsIcon size={20} />} label="設定" onNavigate={close} />
                <div className="pt-2 mt-2 border-t border-hairline">
                  <button
                    onClick={logout}
                    className="w-full flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-[15px] font-medium text-suit-heart active:bg-surface transition-colors"
                  >
                    <LogoutIcon size={20} />
                    ログアウト
                  </button>
                </div>
              </div>

              <div className="p-4 border-t border-hairline">
                <p className="text-xs text-gray2 truncate">
                  {getMockUser()?.email ?? auth.session?.user.email ?? "ゲスト"}
                </p>
                <VersionTag className="mt-1 text-left" />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
