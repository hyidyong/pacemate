import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PwaRegistration } from "@/components/notifications/pwa-registration";

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

export const viewport: Viewport = { themeColor: "#047857" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={inter.variable}>
      <body><PwaRegistration />{children}</body>
    </html>
  );
}
