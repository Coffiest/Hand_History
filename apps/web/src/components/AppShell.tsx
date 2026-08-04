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

// White Cube shell — header and tab bar rebuilt so nothing overlaps anything.
//
// The previous version floated a rounded glass pill above the bottom edge with
// the camera button raised out of it on a negative margin, and dropped the
// version line into the gap underneath. Three separate elements were then
// competing for the same 80px: the raised button clipped the pill's top edge,
// its gold glow bled over the neighbouring label, and the iridescent hairline
// on the pill read on white as a stray coloured line rather than as light.
//
// Both chrome surfaces are now plain opaque bars that own their full width:
//   - the header is a real surface at all times (blurring what scrolls under
//     it) and grows a hairline once the page has moved, so the logo never
//     floats on bare white;
//   - the tab bar is flush to the bottom edge with one hairline on top, the
//     camera lives *inside* it as a filled gold tile, and the active tab is
//     marked by a gold bar drawn on the bar's own top edge — no element
//     crosses another's bounds.
// The version line moved into the document flow below the content, where it
// has room instead of sharing the bar's shadow.

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
        <span className="text-[15px] font-bold text-ink tracking-tight leading-none">
          Hand History
        </span>
      )}
    </Link>
  );
}

/**
 * Alignment is a prop rather than something the caller passes through
 * `className`: `text-center` and `text-left` are the same specificity, so a
 * className override would silently lose to whichever Tailwind emits last.
 */
export function VersionTag({
  className = "",
  align = "center",
}: {
  className?: string;
  align?: "center" | "left";
}) {
  return (
    <p
      className={`${align === "left" ? "text-left" : "text-center"} text-[10px] text-gray3 tabular-nums ${className}`}
    >
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

/**
 * One bottom-bar destination. Every tab is the same 60px-tall cell in a
 * three-column grid, so the icons sit on one baseline and the labels on
 * another — including the camera, whose only difference is that its icon is
 * a filled gold tile instead of a stroke.
 */
function TabItem({
  href,
  label,
  active,
  accent = false,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  /** The primary action: filled tile rather than a stroked glyph. */
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="relative h-[60px] flex flex-col items-center justify-center gap-[3px] active:opacity-60 transition-opacity"
    >
      {active && (
        <motion.span
          layoutId="tab-indicator"
          aria-hidden
          className="absolute top-0 h-[3px] w-8 rounded-b-full bg-gold"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}
      <span
        className={
          accent
            ? "h-[30px] w-[30px] rounded-[10px] bg-gold text-black flex items-center justify-center"
            : active
              ? "text-ink"
              : "text-gray3"
        }
      >
        {children}
      </span>
      <span
        className={`text-[10px] font-semibold leading-none ${
          accent ? "text-gold-dark" : active ? "text-ink" : "text-gray3"
        }`}
      >
        {label}
      </span>
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

  return (
    <div className="min-h-dvh bg-bg flex flex-col">
      {/* Header. Always a surface — only the separating hairline is scroll-dependent. */}
      <header
        className={`sticky top-0 z-40 chrome-bar border-b transition-colors duration-200 ${
          condensed ? "border-hairline" : "border-transparent"
        }`}
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
            className="-mr-2 h-11 w-11 rounded-full flex items-center justify-center text-ink active:bg-surface transition-colors"
          >
            <MenuIcon size={22} />
          </button>
        </div>
      </header>

      {/* Large title (the gallery wall label) */}
      {title && (
        <div className="max-w-lg mx-auto w-full px-5 pt-2 pb-2">
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

      <main className="flex-1 w-full max-w-lg mx-auto px-5 pt-2">{children}</main>

      {/* The version line lives in the flow, after the content: flex-1 above it
          pushes it to the bottom on short pages, and its padding is what
          reserves room for the fixed bar. */}
      <div className="w-full pt-10 pb-[calc(env(safe-area-inset-bottom)+5rem)]">
        <VersionTag />
      </div>

      {/* Bottom tab bar: flush to the edge, one hairline, nothing overlapping. */}
      <nav className="fixed bottom-0 inset-x-0 z-40 chrome-bar border-t border-hairline">
        <div className="max-w-lg mx-auto grid grid-cols-3">
          <TabItem href="/" label="ホーム" active={pathname === "/"}>
            <HomeIcon size={22} />
          </TabItem>
          <TabItem
            href="/hands/new"
            label="記録"
            accent
            active={pathname === "/hands/new"}
          >
            <CameraIcon size={18} />
          </TabItem>
          <TabItem href="/favorites" label="お気に入り" active={pathname === "/favorites"}>
            <StarIcon size={22} />
          </TabItem>
        </div>
        {/* Home-indicator inset as its own row, so it never eats into the targets. */}
        <div style={{ height: "env(safe-area-inset-bottom)" }} />
      </nav>

      {/* Drawer. Solid rather than glass: it covers the tab bar and header, and
          a translucent panel over both of them turned into visual noise. */}
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
              className="fixed top-0 right-0 bottom-0 z-50 w-[78%] max-w-xs bg-bg border-l border-hairline shadow-lift flex flex-col"
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
                  className="-mr-2 h-11 w-11 rounded-full flex items-center justify-center text-gray2 active:bg-surface transition-colors"
                >
                  <CloseIcon size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                <DrawerLink href="/" icon={<HomeIcon size={20} />} label="ホーム" onNavigate={close} />
                <DrawerLink href="/hands/new" icon={<PlusIcon size={20} />} label="新しいハンドを記録" onNavigate={close} />
                <DrawerLink href="/favorites" icon={<StarIcon size={20} />} label="お気に入り" onNavigate={close} />
                <DrawerLink href="/settings" icon={<SettingsIcon size={20} />} label="設定" onNavigate={close} />
              </div>

              <div className="border-t border-hairline p-3">
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-[15px] font-medium text-suit-heart active:bg-surface transition-colors"
                >
                  <LogoutIcon size={20} />
                  ログアウト
                </button>
                <p className="px-4 pt-2 text-xs text-gray2 truncate">
                  {getMockUser()?.email ?? auth.session?.user.email ?? "ゲスト"}
                </p>
                <VersionTag align="left" className="px-4 pt-1 pb-2" />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
