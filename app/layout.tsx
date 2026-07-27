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
          {/* Compact Command Center header: ~58px, sticky, translucent,
              with a thin amber-tinted rule so it separates from the page
              without a heavy border. */}
          <header
            className="sticky top-0 z-20 backdrop-blur"
            style={{
              background: "rgba(15, 23, 28, 0.85)",
              borderBottom: "1px solid rgba(214, 166, 63, 0.18)",
            }}
          >
            <div className="max-w-[1860px] mx-auto px-5 h-[58px] flex items-center gap-6">
              <div className="flex items-center gap-3 shrink-0">
                {/* Restrained geometric mark, pure CSS — no icon dependency. */}
                <span
                  aria-hidden="true"
                  className="inline-block h-3.5 w-3.5 rotate-45 rounded-[2px]"
                  style={{ border: "1.5px solid var(--amber)" }}
                />
                <span className="font-display text-[13px] tracking-[0.22em] uppercase text-platinum-bright whitespace-nowrap">
                  Obsidian <span className="text-platinum-dim">Trader</span>
                </span>
                <span
                  aria-hidden="true"
                  className="h-4 w-px"
                  style={{ background: "var(--border)" }}
                />
                <span
                  className="text-[10px] tracking-[0.18em] uppercase whitespace-nowrap"
                  style={{ color: "var(--amber)" }}
                >
                  Command Center
                </span>
              </div>

              <NavBar />
            </div>
          </header>

          {/* Tight top gap — the dashboard starts right under the header
              rather than after a band of empty space. */}
          <main className="flex-1 max-w-[1860px] mx-auto w-full px-5 pt-4 pb-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
