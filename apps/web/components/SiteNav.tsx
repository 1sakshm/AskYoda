"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const NAV = [
  { href: "/package", label: "npm package" },
  { href: "/cases", label: "Prepared cases" },
  { href: "/real", label: "Real websites" },
  { href: "/recordings", label: "Recorded runs" },
  { href: "/results", label: "Results" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname.startsWith(href);
}

function Links({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-ink-700 bg-ink-900/70 p-1">
      {NAV.map((item) => {
        const active = pathname !== null && isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors sm:px-4 ${
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
