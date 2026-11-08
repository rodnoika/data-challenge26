"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./kit";

const nav = [
  { href: "/", label: "Диалоги", match: (p: string) => p === "/" || p.startsWith("/dialogue") },
  { href: "/appeals/", label: "Апелляции", match: (p: string) => p.startsWith("/appeals") },
  { href: "/checklists/", label: "Чек-листы", match: (p: string) => p.startsWith("/checklists") },
  { href: "/compare/", label: "Сравнение", match: (p: string) => p.startsWith("/compare") },
  { href: "/models/", label: "Модели", match: (p: string) => p.startsWith("/models") },
];

/** Text tabs with an accent underline on the current section. */
export function Nav() {
  const path = usePathname() ?? "/";
  return (
    <nav className="-mb-px flex min-w-0 items-stretch overflow-x-auto text-xs sm:text-sm">
      {nav.map((n) => {
        const on = n.match(path);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on ? "page" : undefined}
            className={cx(
              "flex items-center border-b-2 px-2 whitespace-nowrap sm:px-3",
              on ? "border-accent font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
