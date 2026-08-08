export type ObsidianSignal = {
  schemaVersion: "1";
  kind: "event" | "health";
  signalId: string;
  dedupKey: string;
  occurredAt: string;
  sentAt: string;
  source: { application: "trader"; environment: "staging" | "production"; release?: string };
  payload: Record<string, unknown>;
};

export interface ReporterConfig {
  ingestUrl: string;
  keyId: string;
  signingKey: string;
}
