import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function alpacaCredentials(): { apiKeyId: string; apiSecretKey: string } {
  loadEnvLocal();
  const apiKeyId = process.env.ALPACA_API_KEY_ID;
  const apiSecretKey = process.env.ALPACA_API_SECRET_KEY;
  if (!apiKeyId || !apiSecretKey) throw new Error("Missing Alpaca credentials.");
  return { apiKeyId, apiSecretKey };
}
