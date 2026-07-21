"use client";

import { useState } from "react";
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

// App chrome shared by the main screens, in the same design language as
// RRPoker / Meta-GEO: warm-white translucent header with a card-mark logo and
// a hamburger drawer, plus a bottom bar whose centre is a raised gold camera
// button for instant recording. Every screen shows the app version at the foot.

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 select-none">
      <span className="flex -space-x-1.5">
        <span className="rotate-[-8deg] rounded-md bg-white shadow-card ring-1 ring-border px-1.5 py-0.5 text-[13px] font-black text-ink leading-none">
          A♠
        </span>
        <span className="rotate-[8deg] rounded-md bg-white shadow-card ring-1 ring-border px-1.5 py-0.5 text-[13px] font-black text-suit-heart leading-none">
          K♥
        </span>
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-bold text-ink tracking-tight">Hand History</span>
        <span className="block text-[9px] font-semibold tracking-[0.22em] text-gold-dark uppercase">
          Poker Camera Log
        </span>
      </span>
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();

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
        className={`flex flex-col items-center justify-center gap-0.5 py-2 min-h-[52px] ${
          active ? "text-gold-dark" : "text-gray3"
        }`}
      >
        {icon}
        <span className="text-[10px] font-semibold">{label}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-bg/85 backdrop-blur-md border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <Logo />
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="メニュー"
            className="h-11 w-11 rounded-full flex items-center justify-center text-ink active:scale-95 transition-transform"
          >
            <MenuIcon size={22} />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 w-full max-w-lg mx-auto px-4 pt-4 pb-36">{children}</main>

      {/* Bottom bar with centre camera button */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-white/92 backdrop-blur-md border-t border-border">
        <div className="max-w-lg mx-auto grid grid-cols-3 items-end px-6">
          {navItem("/", <HomeIcon size={22} />, "ホーム")}
          <div className="flex flex-col items-center -mt-7 pb-1.5">
            <Link
              href="/hands/new"
              aria-label="カメラで記録"
              className="h-[64px] w-[64px] rounded-full bg-gold text-black shadow-lift ring-4 ring-white flex items-center justify-center active:scale-90 transition-transform"
            >
              <CameraIcon size={28} />
            </Link>
            <span className="mt-1 text-[10px] font-semibold text-gold-dark">記録</span>
          </div>
          {navItem("/favorites", <StarIcon size={22} />, "お気に入り")}
        </div>
        <div className="pb-safe">
          <VersionTag className="pb-1" />
        </div>
      </nav>

      {/* Hamburger drawer */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.button
              aria-label="メニューを閉じる"
              className="fixed inset-0 z-50 bg-black/45"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
            />
            <motion.aside
              className="fixed top-0 right-0 bottom-0 z-50 w-[78%] max-w-xs bg-bg shadow-lift flex flex-col"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
            >
              <div className="h-14 px-4 flex items-center justify-between border-b border-border">
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
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-[15px] font-medium text-suit-heart active:bg-surface transition-colors"
                >
                  <LogoutIcon size={20} />
                  ログアウト
                </button>
              </div>

              <div className="p-4 border-t border-border">
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
