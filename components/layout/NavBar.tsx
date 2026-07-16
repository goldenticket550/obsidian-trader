"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Scanner/Journal/Performance are placeholders for later phases —
// rendered disabled rather than as dead links to "/".
const NAV_ITEMS: { label: string; href: string | null }[] = [
  { label: "Dashboard", href: "/" },
  { label: "Scanner", href: null },
  { label: "Alerts", href: "/alerts" },
  { label: "Journal", href: "/journal" },
  { label: "Performance", href: null },
  { label: "Settings", href: "/settings" },
];

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-6 flex-1">
      <nav className="flex items-center gap-6">
        {NAV_ITEMS.map((item) => {
          if (!item.href) {
            return (
              <span
                key={item.label}
                className="text-sm text-platinum-dim/40 cursor-not-allowed"
                title="Not built yet"
              >
                {item.label}
              </span>
            );
          }

          const isActive = pathname === item.href;
          return (
            <Link
              key={item.label}
              href={item.href}
              className={
                isActive
                  ? "text-sm text-platinum-bright border-b-2 border-platinum-bright pb-[18px] -mb-[1px]"
                  : "text-sm text-platinum-dim hover:text-platinum"
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={handleSignOut}
        className="ml-auto text-xs text-platinum-dim hover:text-platinum-bright transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
