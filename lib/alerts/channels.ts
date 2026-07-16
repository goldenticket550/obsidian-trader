import type { AlertEvent } from "./types";

/**
 * Every notification channel (in-app, email, SMS, push, Discord,
 * Telegram, Slack) implements this interface. Phase 5 only implements
 * InAppChannel; the others are intentionally not built yet, but any
 * future channel is just a new class implementing `send()` — the alert
 * engine and cooldown logic never need to change.
 */
export interface NotificationChannel {
  name: string;
  send(event: AlertEvent): Promise<void>;
}

/**
 * In-app channel: pushes the event into a provided sink function. In
 * this phase that sink is the AlertStore (see alertStore.ts); the
 * dashboard reads stored events rather than needing a live push
 * connection, which keeps this phase simple (no WebSocket/SSE server
 * needed yet).
 */
export class InAppChannel implements NotificationChannel {
  name = "in-app";

  constructor(private sink: (event: AlertEvent) => void) {}

  async send(event: AlertEvent): Promise<void> {
    this.sink(event);
  }
}

/**
 * Fans a single event out to every configured channel. A failure in one
 * channel doesn't block the others — each is awaited independently and
 * errors are caught, not thrown, so e.g. a future email channel being
 * down for a moment can't silently swallow an in-app alert too.
 */
export async function dispatchToChannels(
  event: AlertEvent,
  channels: NotificationChannel[]
): Promise<void> {
  await Promise.all(
    channels.map((channel) =>
      channel.send(event).catch((err) => {
        console.error(`[alerts] channel "${channel.name}" failed to send:`, err);
      })
    )
  );
}

// Future channels (not implemented in Phase 5, per the spec's phased
// rollout — "begin with in-app alerts"):
//
// export class EmailChannel implements NotificationChannel { ... }
// export class SmsChannel implements NotificationChannel { ... }
// export class PushChannel implements NotificationChannel { ... }
// export class DiscordChannel implements NotificationChannel { ... }
// export class TelegramChannel implements NotificationChannel { ... }
// export class SlackChannel implements NotificationChannel { ... }
