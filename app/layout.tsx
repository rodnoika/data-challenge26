import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CQA · Оценка качества диалогов",
  description: "Conversation Quality Analytics prototype",
};

const nav = [
  { href: "/", label: "Диалоги" },
  { href: "/appeals/", label: "Апелляции" },
  { href: "/checklists/", label: "Чек-листы" },
  { href: "/models/", label: "Модели" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-6 px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">QA</span>
              <span>Conversation Quality Analytics</span>
            </Link>
            <nav className="flex gap-1 text-sm">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-5">{children}</main>
      </body>
    </html>
  );
}
