import { describe, expect, it } from "vitest";
import { AttentionA3ReplayEngine } from "@/lib/attention/attentionA3Replay";
import { AttentionEventEngine, DEFAULT_ATTENTION_EVENT_CONFIG, assertAttentionEventInvariants } from "@/lib/attention/attentionEvents";
import type { AttentionHistoryObservation } from "@/lib/attention/attentionHistory";
import { ATTENTION_UNIVERSE } from "@/lib/attention/universe";
import { createPendingFeedAwareThresholdStore } from "@/lib/replay/feedAwareAttentionThresholds";

const minute=60000;
function observation(at:number,calibrationId:string,score:number,core:number,overrides:Partial<AttentionHistoryObservation>={}):AttentionHistoryObservation{return{symbol:"AAOI",at,score,core,feedMode:"sip",subWindow:"regular",calibrationId,participationBaselineMode:"dense",participationInput:score/20,participationInputKind:"z",displacementZ:score/25,idiosyncrasyZ:score/30,price:100+at/minute*.05,atr:2,vwap:100,ema9:100,consecutiveExpansionBars:0,pullbackObserved:false,priceLostVwap:false,dataQualityState:"ok",provisional:true,...overrides}}
function setup(eventOverrides:Partial<typeof DEFAULT_ATTENTION_EVENT_CONFIG>={}){const store=createPendingFeedAwareThresholdStore(3),calibrationId=store.sets.sip.regular.calibrationId,a3=new AttentionA3ReplayEngine(store,ATTENTION_UNIVERSE),events=new AttentionEventEngine(store,{...DEFAULT_ATTENTION_EVENT_CONFIG,alertEmissionEnabled:true,openingProtectionMinutes:0,...eventOverrides});const process=(at:number,score:number,core:number,overrides:Partial<AttentionHistoryObservation>={},guards:{backfillGuard?:boolean;haltResumeGuard?:boolean;sessionCloseAt?:number;earlyClose?:boolean}={})=>{const frame=a3.processMinute([observation(at,calibrationId,score,core,overrides)]);events.processFrame({frame,regularOpenAt:0,sessionCloseAt:guards.sessionCloseAt??24*60*minute,earlyClose:guards.earlyClose,backfillGuard:guards.backfillGuard,haltResumeGuard:guards.haltResumeGuard});return frame};return{store,a3,events,process}}
function qualify(process:ReturnType<typeof setup>["process"]){process(0,30,.30);process(minute,32,.30);process(2*minute,55,.55);process(3*minute,57,.55);process(4*minute,82,.82);return process(5*minute,84,.82)}

describe("Phase C replay-only events and episode lifecycle",()=>{
  it("emits one NOW IN PLAY across a cooling re-entry and a second after timeout completion",()=>{const {events,process}=setup();const first=qualify(process);expect(first.rows[0].episode).toMatchObject({firstInPlayAt:5*minute,inPlayEntryCount:1});expect(events.snapshot().alerts.filter(row=>row.type==="NOW_IN_PLAY")).toHaveLength(1);process(6*minute,20,.10);process(7*minute,20,.10);process(8*minute,82,.82);const reentered=process(9*minute,84,.82);expect(reentered.rows[0].episode).toMatchObject({state:"active",inPlayEntryCount:2,reentryCount:1});expect(events.snapshot().alerts.filter(row=>row.type==="NOW_IN_PLAY")).toHaveLength(1);process(10*minute,20,.10);process(11*minute,20,.10);for(let m=12;m<=56;m++)process(m*minute,20,.10);expect(process(57*minute,82,.82).rows[0].episode?.state).toBe("completed");const second=process(58*minute,84,.82);expect(second.rows[0].episode?.episodeId).not.toBe(first.rows[0].episode?.episodeId);expect(events.snapshot().alerts.filter(row=>row.type==="NOW_IN_PLAY")).toHaveLength(2)});

  it("keeps a suppressed NOW IN PLAY pending and emits it after the guard clears",()=>{const {events,process}=setup();process(0,30,.30);process(minute,32,.30);process(2*minute,55,.55);process(3*minute,57,.55);process(4*minute,82,.82);const frame=process(5*minute,84,.82,{}, {backfillGuard:true});const identity=`NOW_IN_PLAY|${frame.rows[0].episode!.episodeId}`;expect(events.snapshot().alerts).toHaveLength(0);expect(events.snapshot().pending).toContainEqual(expect.objectContaining({identity}));expect(events.snapshot().suppressions).toContainEqual(expect.objectContaining({reason:"backfill_guard",disposition:"pending"}));process(6*minute,84,.82,{displacementZ:6});expect(events.snapshot().alerts).toContainEqual(expect.objectContaining({type:"NOW_IN_PLAY",episodeId:frame.rows[0].episode!.episodeId}))});

  it("drops a guarded pending alert after ten minutes instead of leaking it late",()=>{
    const {events,process}=setup({pendingAlertMaxAgeMinutes:10});
    process(0,30,.30);process(minute,32,.30);process(2*minute,55,.55);process(3*minute,57,.55);process(4*minute,82,.82);
    process(5*minute,84,.82,{}, {backfillGuard:true});
    process(16*minute,84,.82);
    expect(events.snapshot().alerts).toHaveLength(0);
    expect(events.snapshot().pending).toHaveLength(0);
    expect(events.snapshot().suppressions).toContainEqual(expect.objectContaining({
      reason:"pending_expired",disposition:"dropped",
    }));
  });

  it("drops rather than emits after the exchange-calendar session close",()=>{
    const {events,process}=setup();
    process(0,30,.30);process(minute,32,.30);process(2*minute,55,.55);process(3*minute,57,.55);process(4*minute,82,.82);
    process(5*minute,84,.82,{}, {sessionCloseAt:4*minute});
    expect(events.snapshot().alerts).toHaveLength(0);
    expect(events.snapshot().pending).toHaveLength(0);
    expect(events.snapshot().suppressions).toContainEqual(expect.objectContaining({
      reason:"session_closed",disposition:"dropped",
    }));
  });

  it("drops early-close closing-auction qualifications until a close-relative baseline exists",()=>{
    const {events,process}=setup({earlyCloseClosingAuctionExclusionMinutes:15});
    process(0,30,.30);process(minute,32,.30);process(2*minute,55,.55);process(3*minute,57,.55);process(4*minute,82,.82);
    process(5*minute,84,.82,{}, {sessionCloseAt:20*minute,earlyClose:true});
    expect(events.snapshot().alerts).toHaveLength(0);
    expect(events.snapshot().suppressions).toContainEqual(expect.objectContaining({
      reason:"early_close_baseline_unavailable",disposition:"dropped",
    }));
  });
  it("keeps Extended as an ACCELERATION suppression reason",()=>{
    const {events,process}=setup({accelerationPersistenceMinutes:2});
    qualify(process);
    process(6*minute,90,.86,{participationInput:6,displacementZ:5,price:110,vwap:100,ema9:100});
    process(7*minute,92,.88,{participationInput:7,displacementZ:6,price:111,vwap:100,ema9:100});
    expect(events.snapshot().alerts.filter(row=>row.type==="ACCELERATION")).toHaveLength(0);
    expect(events.snapshot().suppressions).toContainEqual(expect.objectContaining({
      eventType:"ACCELERATION",reason:"extended",disposition:"pending",
    }));
  });
  it("requires participation and displacement acceleration together",()=>{const {events,process}=setup({accelerationPersistenceMinutes:2});qualify(process);process(6*minute,90,.85,{participationInput:6,displacementZ:3.4});process(7*minute,92,.86,{participationInput:7,displacementZ:3.45});expect(events.snapshot().alerts.filter(row=>row.type==="ACCELERATION")).toHaveLength(0);process(8*minute,94,.88,{participationInput:8,displacementZ:4.3});process(9*minute,96,.90,{participationInput:9,displacementZ:5.2});expect(events.snapshot().alerts.filter(row=>row.type==="ACCELERATION")).toHaveLength(1)});

  it("emits an Extended NOW IN PLAY immediately with a prominent do-not-chase warning and enforces I6/I7",()=>{
    const {store,events,process}=setup();
    process(0,30,.30);process(minute,32,.30);process(2*minute,55,.55);process(3*minute,57,.55);
    process(4*minute,82,.82);
    const qualifying=process(5*minute,84,.82,{price:104,vwap:100,ema9:100});
    expect(qualifying.rows[0].freshness?.freshness).toBe("Extended");
    const event=events.snapshot().alerts.find(row=>row.type==="NOW_IN_PLAY")!;
    expect(event).toMatchObject({qualifiedAt:5*minute,emittedAt:5*minute,at:5*minute});
    expect(event.payload).toMatchObject({
      at:5*minute,attentionScore:84,core:.82,rawCore:.82,freshness:"Extended",
      extensionWarning:"EXTENDED \u2014 do not chase",
      contextBadges:[{kind:"vwap_distance",label:"2.0 ATR from VWAP",value:2,unit:"atr"}],
    });
    expect(()=>assertAttentionEventInvariants(event,store)).not.toThrow();
    const badI6={...event,payload:{...event.payload,core:.012,rawCore:.012,attentionScore:1.05}};
    expect(()=>assertAttentionEventInvariants(badI6,store)).toThrow(/I6 ALERT PAYLOAD CONSISTENCY/);
    const badI7={...event,at:event.emittedAt+minute,payload:{...event.payload,at:event.emittedAt+minute}};
    expect(()=>assertAttentionEventInvariants(badI7,store)).toThrow(/I7 ALERT PAYLOAD SNAPSHOT/);
  });


  it("keeps VWAP distance and expansion run as factual badges, not decision gates",()=>{
    const {events,process}=setup();
    process(0,30,.30);process(minute,32,.30);process(2*minute,55,.55);process(3*minute,57,.55);
    process(4*minute,82,.82,{price:101,vwap:100,ema9:101,consecutiveExpansionBars:4,pullbackObserved:true});
    process(5*minute,84,.82,{price:101,vwap:100,ema9:101,consecutiveExpansionBars:5,pullbackObserved:true});
    const event=events.snapshot().alerts.find(row=>row.type==="NOW_IN_PLAY")!;
    expect(event.payload.contextBadges).toEqual([
      {kind:"vwap_distance",label:"0.5 ATR from VWAP",value:.5,unit:"atr"},
      {kind:"expansion_run",label:"5 expansion bars",value:5,unit:"bars"},
    ]);
  });  it("suppresses same-minute ACCELERATION as redundant with entry",()=>{
    const {events,process}=setup({accelerationPersistenceMinutes:2});
    process(0,30,.30);process(minute,32,.30);process(2*minute,55,.55);process(3*minute,57,.55);
    process(4*minute,82,.82,{participationInput:5,displacementZ:4,idiosyncrasyZ:1});
    process(5*minute,84,.82,{participationInput:6,displacementZ:5,idiosyncrasyZ:1});
    expect(events.snapshot().alerts.map(row=>row.type)).toEqual(["NOW_IN_PLAY"]);
    expect(events.snapshot().suppressions).toContainEqual(expect.objectContaining({
      eventType:"ACCELERATION",reason:"redundant_with_entry",disposition:"discard_duplicate",
    }));
  });
  it("rollback flag off creates, stores, and surfaces no alert or suppression",()=>{const store=createPendingFeedAwareThresholdStore(3),a3=new AttentionA3ReplayEngine(store,ATTENTION_UNIVERSE),events=new AttentionEventEngine(store,{...DEFAULT_ATTENTION_EVENT_CONFIG,alertEmissionEnabled:false}),id=store.sets.sip.regular.calibrationId;for(const [i,score,core] of [[0,30,.3],[1,32,.3],[2,55,.55],[3,57,.55],[4,82,.82],[5,84,.82]] as const){const frame=a3.processMinute([observation(i*minute,id,score,core)]);expect(events.processFrame({frame,regularOpenAt:0,sessionCloseAt:24*60*minute})).toEqual({emitted:[],suppressions:[]})}expect(events.snapshot()).toEqual({alerts:[],suppressions:[],pending:[]})});
});