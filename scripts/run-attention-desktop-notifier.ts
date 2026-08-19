import { resolve } from "node:path";
import { JsonFileRuntimeStore } from "../lib/attention-runtime/jsonFileStore";
import { SupabaseRuntimeStore } from "../lib/attention-runtime/supabaseStore";
import type { RuntimeStore } from "../lib/attention-runtime/contracts";
import { createAdminClient } from "../lib/supabase/admin";
import { loadEnvLocal } from "../lib/replay/env";
import { AttentionOutboxConsumer, WindowsDesktopNotificationSink } from "../lib/attention-runtime/notifier";

async function main() {
  loadEnvLocal();
  const engineInstanceId = process.env.ATTENTION_ENGINE_INSTANCE_ID ?? "attention-shadow-iex-static-v1";
  const store: RuntimeStore = process.env.ATTENTION_RUNTIME_STORE === "supabase"
    ? new SupabaseRuntimeStore(createAdminClient(), {
        engineInstanceId, runId: `notifier-${process.pid}`, userId: process.env.ATTENTION_USER_ID ?? "notifier",
        universeHash: "notifier-read-only", calibrationId: "notifier-read-only", configHash: "notifier-read-only", baselineTableId: "notifier-read-only", feedMode: "iex_partial",
      })
    : new JsonFileRuntimeStore(process.env.ATTENTION_RUNTIME_STATE_PATH ?? resolve("data/runtime-shadow/runtime-state-static-v1.json"));
  const consumer = new AttentionOutboxConsumer(store, new WindowsDesktopNotificationSink(), `desktop-${process.pid}`, engineInstanceId);
  const once = process.argv.includes("--once");
  do {
    const result = await consumer.deliverOnce();
    if (once) { console.log(JSON.stringify(result)); break; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
  } while (true);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
