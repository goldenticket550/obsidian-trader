import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/layout/NavBar";

export const metadata: Metadata = {
  title: "Obsidian Trader",
  description: "Personal AI-assisted trading scanner, setup validator, and journal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-obsidian-border bg-obsidian-charcoal/80 backdrop-blur sticky top-0 z-10">
            <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-8">
              <span className="font-display text-sm tracking-[0.2em] text-platinum-bright uppercase">
                Obsidian <span className="text-platinum-dim">Trader</span>
              </span>
              <NavBar />
            </div>
          </header>
          <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
