import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
});


export const metadata: Metadata = {
  title: "CryptoPredict — прогнозы и сделки по криптовалютам",
  description: "Прогнозы по криптовалютам на обученных моделях, сделки с планом и честной статистикой после комиссий.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark h-full">
      <body className={`${inter.variable} font-sans antialiased h-full`}>
        {children}
      </body>
    </html>
  );
}
