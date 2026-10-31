import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";

import Logo from "@/components/Logo";
import SiteNav from "@/components/SiteNav";
import { DEMO_MODE, PUBLIC_DEMO } from "@/lib/api";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "AskYoda",
  description:
    "TinyFish agents can do the work. We tell you when they didn't, why, and fix it automatically.",
};

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-ochre-800/60 bg-ochre-950/80 px-6 py-2 text-center font-mono text-xs tracking-wide text-ochre-200">
      {children}
    </div>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {DEMO_MODE && (
          <Notice>Demo deployment · replays bundled runs · live runs need the API</Notice>
        )}
        {!DEMO_MODE && PUBLIC_DEMO && (
          <Notice>Live demo · real TinyFish runs · shared budget, one run at a time</Notice>
        )}
        <header className="sticky top-0 z-20 border-b border-ink-800/80 bg-ink-950/75 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3 sm:px-8">
            <Link href="/" className="group flex items-center gap-3">
              <Logo />
              <span className="font-display text-2xl leading-none tracking-tight text-ink-50">
                AskYoda
              </span>
              <span className="kicker hidden border-l border-ink-700 pl-3 md:inline">
                agent reliability
              </span>
            </Link>
            <SiteNav />
          </div>
        </header>
        <div className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-5 py-10 sm:px-8">
          {children}
        </div>
        <footer className="border-t border-ink-800/80">
          <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-ink-400 sm:px-8">
            <span>
              <span className="font-display text-base text-ink-200">AskYoda</span> · a reliability
              layer for TinyFish web agents
            </span>
            <span className="kicker">verify · diagnose · fix</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
