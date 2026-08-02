import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "AI Crypto Predictor — Интеллектуальные прогнозы криптовалют",
  description:
    "Получайте AI-прогнозы движения криптовалют с использованием современных языковых моделей и технического анализа.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark h-full">
      <body className={`${inter.variable} ${outfit.variable} font-sans antialiased h-full`}>
        {children}
      </body>
    </html>
  );
}
