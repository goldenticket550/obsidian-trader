import type { ObsidianSignal, ReporterConfig } from "./types";
import { signBody } from "./sign";

type RpcResult = { data: any; error: { message?: string } | null };
type Db = {
  from(name: string): any;
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
};

function assertRpc(result: RpcResult, operation: string): void {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message ?? "unknown error"}`);
}

export function createReporter(db: Db, config: ReporterConfig) {
  return {
    async report(signal: ObsidianSignal): Promise<void> {
      const { error }=await db.from("core_signal_outbox").insert({dedup_key:signal.dedupKey,signal});
      if(error && error.code!=="23505") throw new Error(`Core outbox enqueue failed: ${error.message}`);
    },
    async drain(limit=20): Promise<{delivered:number;retried:number}> {
      const claimed=await db.rpc("claim_core_signal_outbox",{p_limit:limit});
      if(claimed.error) throw new Error(`Core outbox claim failed: ${claimed.error.message}`);
      let delivered=0,retried=0;
      for(const row of claimed.data??[]){
        try{
          const body=JSON.stringify(row.signal); const timestamp=Math.floor(Date.now()/1000);
          const response=await fetch(config.ingestUrl,{method:"POST",headers:{"content-type":"application/json","x-obsidian-key-id":config.keyId,"x-obsidian-signature":signBody(body,timestamp,config.signingKey)},body,signal:AbortSignal.timeout(5000)});
          if(!response.ok) throw new Error(`Core returned ${response.status}`);
          const completed = await db.rpc("complete_core_signal_outbox", { p_id: row.id });
          assertRpc(completed, "Core outbox completion");
          delivered++;
        }catch(error){
          const message=error instanceof Error?error.message:"Unknown Core delivery error";
          const delay=Math.min(3600,Math.max(5,2**Math.min(row.attempts,10)*5));
          const retriedResult = await db.rpc("retry_core_signal_outbox", {
            p_id: row.id,
            p_error: message,
            p_delay_seconds: delay,
          });
          assertRpc(retriedResult, "Core outbox retry");
          retried++;
        }
      }
      return {delivered,retried};
    }
  };
}
