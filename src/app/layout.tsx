import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaceMate",
  description: "AI academic assistant and major adaptation community platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
