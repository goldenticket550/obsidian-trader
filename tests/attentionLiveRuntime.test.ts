import { describe, expect, it } from "vitest";
import { InMemoryRuntimeStore } from "@/lib/attention-runtime/inMemoryStore";
import { AttentionLiveWorker, type AttentionRuntimeProcessor } from "@/lib/attention-runtime/worker";
import { inferIexHaltResumes, probeIexStreamCapability, type LiveIngestionSource, type WebSocketLike } from "@/lib/attention-runtime/ingestion";
import { AttentionOutboxConsumer, type NotificationSink } from "@/lib/attention-runtime/notifier";
import type { LiveMinuteBatch, RuntimeDeliveryEnvelope, RuntimeIdentity, RuntimeProcessorResult } from "@/lib/attention-runtime/contracts";

const baseAt = Math.floor(Date.now() / 60_000) * 60_000;
const identity: RuntimeIdentity = { engineInstanceId: "test", runId: "run", userId: "user", universeHash: "u", calibrationId: "c", configHash: "cfg", baselineTableId: "baseline", feedMode: "iex_partial" };
function batch(at: number): LiveMinuteBatch { return { at, tradingDate: "2026-08-18", minuteOfDay: 660 + Math.round((at-baseAt)/60_000), mode: "mock", requestedSymbols: ["SPY"], barsBySymbol: {}, latestBarBySymbol: { SPY: null }, responseFeed: "mock", complete: true, staleSymbols: [], missingSymbols: [], guard: { active: false, reason: "none", activeSince: null, contiguousMinutes: 5, requiredContiguousMinutes: 5 }, audit: [] }; }
class Source implements LiveIngestionSource { readonly mode="mock" as const; constructor(private readonly at:number){} async readCompletedMinute(){return batch(this.at);} }
class Processor implements AttentionRuntimeProcessor {
  count=0; restore(state:unknown){this.count=(state as {count?:number}|null)?.count??0;}
  async process():Promise<RuntimeProcessorResult>{this.count++;return{rows:[],events:[],processorState:{count:this.count},statusMessage:`count=${this.count}`};}
}
function controls(store:InMemoryRuntimeStore, at:number){store.setControls({version:1,attentionLiveAlertingEnabled:false,legacyAlertingEnabled:true,activeAlertEngine:"legacy",updatedAt:at,reason:"shadow"});}

describe("live Attention runtime",()=>{
  it("is fenced, fail-closed, and restart-equivalent at minute boundaries",async()=>{
    const store=new InMemoryRuntimeStore();controls(store,baseAt);
    const firstProcessor=new Processor(), first=new AttentionLiveWorker(store,new Source(baseAt),firstProcessor,{identity,shadow:true});
    await first.start(baseAt);const one=await first.runOnce(baseAt);await first.stop();
    expect(one.shadow).toBe(true);expect(one.liveDeliveryEnabled).toBe(false);expect(one.legacyAlertingEnabled).toBe(true);
    const restartedProcessor=new Processor(), restarted=new AttentionLiveWorker(store,new Source(baseAt+60_000),restartedProcessor,{identity,shadow:true});
    await restarted.start(baseAt+60_000);const two=await restarted.runOnce(baseAt+60_000);await restarted.stop();
    expect(two.sequence).toBe(2);expect(two.statusMessage).toContain("count=2");expect(restartedProcessor.count).toBe(2);
  });

  it("falls back when the stream acknowledges only 30 of 68 symbols",async()=>{
    const symbols=Array.from({length:68},(_,i)=>`S${i}`);
    let listener:(event:any)=>void=()=>{};
    const socket:WebSocketLike={addEventListener(type,callback){if(type==="message")listener=callback;},send(data){const action=JSON.parse(data).action;if(action==="auth")listener({data:JSON.stringify([{T:"success",msg:"authenticated"}])});if(action==="subscribe")listener({data:JSON.stringify([{T:"subscription",bars:symbols.slice(0,30)}])});},close(){}};
    const pending=probeIexStreamCapability({symbols,apiKeyId:"k",apiSecretKey:"s",createWebSocket:()=>socket});
    listener({data:JSON.stringify([{T:"success",msg:"connected"}])});
    await expect(pending).resolves.toMatchObject({mode:"iex_rest_polling",requestedSymbols:68,acknowledgedSymbols:30,complete:false});
  });

  it("marks a no-print run with a gapped resume as inferred, never confirmed",()=>{
    const candle=(time:number,open:number,close:number)=>({time,open,high:Math.max(open,close),low:Math.min(open,close),close,volume:100});
    const completedAt=baseAt;
    expect(inferIexHaltResumes({AAOI:[candle(completedAt/1000-7*60,100,100),candle(completedAt/1000,101,101)]},completedAt)).toEqual(["AAOI"]);
    expect(inferIexHaltResumes({AAOI:[candle(completedAt/1000-7*60,100,100),candle(completedAt/1000,100.1,100.1)]},completedAt)).toEqual([]);
  });
  it("retries failed out-of-band delivery and preserves its tier",async()=>{
    const store=new InMemoryRuntimeStore();let calls=0,tier="";
    const envelope:RuntimeDeliveryEnvelope={id:"d",idempotencyKey:"d",engineInstanceId:"test",tier:"secondary",kind:"digest",createdAt:baseAt,expiresAt:baseAt+3600000,eventIds:["e"],title:"Context",message:"one event",fullListHref:"/attention",status:"pending",attemptCount:0,nextAttemptAt:baseAt,leaseOwner:null,leaseExpiresAt:null,deliveredAt:null,lastError:null,providerAcknowledgement:null};store.outbox.push(envelope);
    store.setControls({version:1,attentionLiveAlertingEnabled:true,legacyAlertingEnabled:false,activeAlertEngine:"attention",updatedAt:baseAt,reason:"test"});
    const sink:NotificationSink={async send(row){calls++;tier=row.tier;if(calls===1)throw new Error("offline");return "ok";}};
    const consumer=new AttentionOutboxConsumer(store,sink,"desktop","test");
    expect((await consumer.deliverOnce(baseAt)).retried).toBe(1);
    expect((await consumer.deliverOnce(baseAt+5000)).delivered).toBe(1);
    expect(tier).toBe("secondary");expect(store.outbox[0].status).toBe("delivered");
  });
});
