import type { RuntimeDeliveryEnvelope, RuntimeStore } from "./contracts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface NotificationSink {
  send(envelope: RuntimeDeliveryEnvelope): Promise<string>;
}

export interface NotifierRunResult {
  leased: number;
  delivered: number;
  retried: number;
  permanentlyFailed: number;
}

export class AttentionOutboxConsumer {
  constructor(
    private readonly store: RuntimeStore,
    private readonly sink: NotificationSink,
    private readonly consumerId: string,
    private readonly engineInstanceId: string,
    private readonly maxAttempts = 6,
  ) {}

  async deliverOnce(now = Date.now(), limit = 20): Promise<NotifierRunResult> {
    const controls = await this.store.readControls(this.engineInstanceId);
    if (!controls || !controls.attentionLiveAlertingEnabled || controls.activeAlertEngine !== "attention") {
      return { leased: 0, delivered: 0, retried: 0, permanentlyFailed: 0 };
    }
    const rows = await this.store.leaseOutbox(this.consumerId, now, limit, 30_000);
    const result: NotifierRunResult = { leased: rows.length, delivered: 0, retried: 0, permanentlyFailed: 0 };
    for (const row of rows) {
      try {
        const acknowledgement = await this.sink.send(row);
        await this.store.acknowledgeOutbox(row.id, this.consumerId, Date.now(), acknowledgement);
        result.delivered += 1;
      } catch (error) {
        const attempts = row.attemptCount + 1;
        const retryAt = attempts >= this.maxAttempts
          ? null
          : now + Math.min(15 * 60_000, 5_000 * 2 ** (attempts - 1));
        await this.store.failOutbox(row.id, this.consumerId, Date.now(), error instanceof Error ? error.message : String(error), retryAt);
        if (retryAt === null) result.permanentlyFailed += 1;
        else result.retried += 1;
      }
    }
    return result;
  }
}

/** Injectable native adapter. Production startup supplies a platform implementation. */
export class CallbackNotificationSink implements NotificationSink {
  constructor(private readonly callback: (title: string, message: string, href: string) => Promise<string>) {}
  async send(envelope: RuntimeDeliveryEnvelope): Promise<string> {
    return this.callback(envelope.title, envelope.message, envelope.fullListHref);
  }
}

/** Native Windows balloon; arguments are passed out-of-band and never interpolated as code. */
export class WindowsDesktopNotificationSink implements NotificationSink {
  async send(envelope: RuntimeDeliveryEnvelope): Promise<string> {
    if (process.platform !== "win32") throw new Error("Windows desktop notification sink is unavailable on this platform.");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms", "$n = New-Object System.Windows.Forms.NotifyIcon",
      "$n.Icon = [System.Drawing.SystemIcons]::Information", "$n.BalloonTipTitle = $args[0]",
      "$n.BalloonTipText = $args[1]", "$n.Visible = $true", "$n.ShowBalloonTip(8000)",
      "Start-Sleep -Milliseconds 8500", "$n.Dispose()",
    ].join("; ");
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script, envelope.title, envelope.message], { windowsHide: true, timeout: 15_000 });
    return `windows-balloon:${envelope.idempotencyKey}`;
  }
}