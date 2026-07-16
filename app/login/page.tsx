"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-obsidian-black">
      <div className="panel p-8 w-full max-w-sm">
        <h1 className="font-display text-sm tracking-[0.2em] text-platinum-bright uppercase mb-1">
          Obsidian <span className="text-platinum-dim">Trader</span>
        </h1>
        <p className="text-xs text-platinum-dim mb-6">Sign in to access your watchlist and settings.</p>

        {status === "sent" ? (
          <div className="text-sm text-signal-green">
            Check your email for a sign-in link. You can close this tab.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs text-platinum-dim mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-obsidian-charcoal border border-obsidian-border rounded px-3 py-2 text-sm text-platinum-bright focus:outline-none focus:border-platinum-dim"
                placeholder="you@example.com"
              />
            </div>

            {status === "error" && errorMessage && (
              <div className="text-xs text-signal-red">{errorMessage}</div>
            )}

            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 border border-obsidian-border rounded px-3 py-2 text-sm text-platinum-bright transition-colors"
            >
              {status === "sending" ? "Sending link…" : "Send sign-in link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
