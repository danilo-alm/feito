import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import type { ReactNode } from "react";
import { LanguageProvider, SkipToContent } from "@feito/ui/components/language";
import { OfflineRegistration } from "@/components/offline-status";
import "@feito/ui/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Fonte do nome "Feito" (docs/05-brand.md). Só o peso 600 é carregado.
const interTight = Inter_Tight({ subsets: ["latin"], weight: "600", variable: "--font-brand", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Feito", template: "%s · Feito" },
  description: "Suas tarefas pessoais, nesta instalação.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F4EF" },
    { media: "(prefers-color-scheme: dark)", color: "#1B1A18" },
  ],
};

const systemTheme = `if(matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.classList.add("dark")`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${interTight.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: systemTheme }} /></head>
      <body>
        <LanguageProvider><SkipToContent /></LanguageProvider>
        <OfflineRegistration />
        {children}
      </body>
    </html>
  );
}
