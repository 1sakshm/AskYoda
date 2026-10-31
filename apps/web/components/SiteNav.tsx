"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const NAV = [
  { href: "/", label: "Run" },
  { href: "/results", label: "Results" },
  { href: "/dev", label: "Sample" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/runs");
  return pathname.startsWith(href);
}

function Links({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900/70 p-1">
      {NAV.map((item) => {
        const active = pathname !== null && isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              active
                ? "bg-ink-100 font-medium text-ink-950"
                : "text-ink-300 hover:bg-ink-800 hover:text-ink-50"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function CurrentLinks() {
  return <Links pathname={usePathname() ?? "/"} />;
}

/** The pathname is runtime data under Cache Components: render inactive links until it is known. */
export default function SiteNav() {
  return (
    <Suspense fallback={<Links pathname={null} />}>
      <CurrentLinks />
    </Suspense>
  );
}
