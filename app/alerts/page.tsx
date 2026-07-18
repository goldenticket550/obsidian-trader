"use client";

import { useEffect, useState } from "react";
import type { AlertEvent } from "@/lib/alerts/types";
import { defaultAlertRules } from "@/lib/alerts/defaultRules";

export default function AlertsPage() {
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/alerts")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load alerts: ${res.status}`);
        return res.json();
      })
      .then((json: { events: AlertEvent[] }) => {
        if (!cancelled) setEvents(json.events);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim mb-4">
          Alert Rules
        </h2>
        <p className="text-xs text-platinum-dim mb-4">
          In-app alerts only for now — email, SMS, push, Discord, Telegram, and Slack are
          structured to be added later without changing this rule list.
        </p>
        <ul className="divide-y divide-obsidian-border/60">
          {defaultAlertRules.map((rule) => (
            <li key={rule.id} className="py-2.5 flex items-center justify-between text-sm">
              <span className="text-platinum-bright">{rule.label}</span>
              <span className="text-xs text-platinum-dim font-mono">
                {rule.type === "score_threshold" && rule.scoreThreshold
                  ? `score ≥ ${rule.scoreThreshold} · `
                  : ""}
                cooldown {Math.round(rule.cooldownMs / 60000)}m
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="px-5 py-4 border-b border-obsidian-border flex items-center justify-between">
          <h2 className="text-sm font-display uppercase tracking-wider text-platinum-dim">
            Recent Alerts
          </h2>
          {events && <span className="text-xs text-platinum-dim">{events.length} events</span>}
        </div>

        {error && <div className="p-5 text-sm text-signal-red">Failed to load: {error}</div>}

        {!events && !error && (
          <div className="p-5 text-sm text-platinum-dim">Loading alert history…</div>
        )}

        {events && events.length === 0 && (
          <div className="p-5 text-sm text-platinum-dim">
            No alerts have fired yet. Alerts fire on the scan after a condition first passes —
            visit the dashboard to trigger a scan, then check back here.
          </div>
        )}

        {events && events.length > 0 && (
          <ul className="divide-y divide-obsidian-border/60">
            {events.map((event) => (
              <li key={event.id} className="px-5 py-3 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-platinum-bright">{event.message}</div>
                  <div className="text-xs text-platinum-dim mt-0.5">{event.type}</div>
                </div>
                <span className="text-xs text-platinum-dim font-mono shrink-0 text-right">
                  scanned {new Date(event.firedAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
