import type { Metadata, Viewport } from "next";
import "./globals.css";

// Service name is a placeholder ("仮") — the user will finalise it later.
export const metadata: Metadata = {
  title: "Hand History (仮)",
  description: "トランプをカメラで撮るだけでポーカーのハンドを記録・共有",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Hand History" },
};

export const viewport: Viewport = {
  themeColor: "#FFFBF5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="font-sans bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
