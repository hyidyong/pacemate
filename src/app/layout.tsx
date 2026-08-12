import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import PwaRegistration from "@/components/notifications/pwa-registration";
import "./globals.css";

// ✅ [Opt 5] next/font으로 Google Font 최적화 — FOUT 제거, 별도 HTTP 요청 없음
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: { default: "PaceMate", template: "%s | PaceMate" },
  description: "AI 기반 학업 어시스턴트 및 전공 적응 커뮤니티 플랫폼",
  metadataBase: new URL("https://pacemate-tau.vercel.app"),
  manifest: "/manifest.webmanifest",
};

// viewport-fit=cover is required for env(safe-area-inset-*) to resolve to
// anything but 0 — without it every safe-area rule in the app was a no-op
// on notched devices (Stage 4, audit C-28).
export const viewport: Viewport = { themeColor: "#6BCB77", viewportFit: "cover" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={inter.variable}>
      <body>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
