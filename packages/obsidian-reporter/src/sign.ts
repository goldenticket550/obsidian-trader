import { createHmac } from "node:crypto";

export function signBody(body: string, timestamp: number, key: string): string {
  const digest=createHmac("sha256",key).update(`${timestamp}.${body}`).digest("hex");
  return `v=${timestamp},d=${digest}`;
}
