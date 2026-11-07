import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { Nav } from "@/ui/Nav";

export const metadata: Metadata = {
  title: "CQA · Оценка качества диалогов",
  description: "Conversation Quality Analytics prototype",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-40 border-b border-rule bg-sheet">
          <div className="mx-auto flex h-11 max-w-[1500px] items-stretch gap-2 px-3 sm:gap-6 sm:px-4">
            <Link href="/" className="flex shrink-0 items-center gap-2.5">
              <span className="border border-ink bg-ink px-1.5 font-mono text-xs leading-5 font-medium tracking-wider text-paper">CQA</span>
              <span className="hidden text-sm font-medium text-ink-2 md:inline">Conversation Quality Analytics</span>
            </Link>
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-3 py-4 sm:px-4">{children}</main>
      </body>
    </html>
  );
}
