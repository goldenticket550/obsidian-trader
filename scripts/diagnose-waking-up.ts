import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { AttentionA3Frame, AttentionA3FrameRow } from "../lib/attention/attentionA3Replay";
import { updateAttentionHistory, type AttentionHistoryState } from "../lib/attention/attentionHistory";
import { computeAttentionVelocity } from "../lib/attention/attentionVelocity";
import { assertAttentionStateFrameInvariants, explainAttentionState, updateAttentionState } from "../lib/attention/attentionState";
import { startAttentionEpisode, updateAttentionEpisode, type AttentionEpisode } from "../lib/attention/attentionEpisodes";
import { updateAttentionCooling } from "../lib/attention/attentionCooling";
import { buildAttentionLists } from "../lib/attention/attentionLists";
import { rankableUniverse } from "../lib/attention/universePolicy";
import { SipSessionDigestCollector } from "../lib/replay/sessionDigest";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import type { AttentionHistoryObservation } from "../lib/attention/attentionHistory";
import { classifyAttentionFreshness } from "../lib/attention/attentionFreshness";
import type { AttentionFeedMode } from "../lib/attention/attentionScore";
import { PRE_STREAM_REPLAY_DISCLOSURE, sha256, stableJson } from "../lib/replay/archive";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import { assertFeedAwareAttentionThresholdStore, thresholdValuesForReplay } from "../lib/replay/feedAwareAttentionThresholds";
import { quantile, scoreRawCalibrationPoint, type RawCalibrationPoint } from "../lib/replay/populationCalibration";
import { ATTENTION_SUB_WINDOWS, type AttentionSubWindow } from "../lib/replay/attentionThresholdTypes";

type Tuple = [number, number, number, number, number, 0|1, 0|1|2, number, number, number, number, number|null, number|null, number, 0|1, 0|1, 0|1];
interface Corpus { splitHash:string; dates:string[]; symbols:string[]; feeds:{sip:Tuple[];iex_partial:Tuple[]}; }
interface Session { tradingDate:string; split:"train"|"holdout"; primaryRegime:string; tags:string[]; earlyClose:boolean; }
interface Manifest { splitHash:string; sessions:Session[]; }
interface Dist { count:number; min:number|null; p50:number|null; p75:number|null; p90:number|null; p95:number|null; p99:number|null; max:number|null; }

const feedModes:AttentionFeedMode[]=["sip","iex_partial"];
const modeName=["dense","sparse","dead"] as const;
const MINIMUM_WAKING_SCORE=40;
const MAXIMUM_WAKING_ATR_TRAVEL=1.5;
const MINIMUM_STATE_PERSISTENCE=2;

function windowAt(m:number):AttentionSubWindow|null {
  if(m>=240&&m<420)return "premarket_early";
  if(m>=420&&m<540)return "premarket_core";
  if(m>=540&&m<570)return "premarket_final";
  if(m>=570&&m<960)return "regular";
  if(m>=960&&m<1080)return "after_hours_core";
  if(m>=1080&&m<1200)return "after_hours_late";
  return null;
}
function configured(s:Session,m:number){return !(s.earlyClose&&m>=780&&m<960)&&windowAt(m)!==null;}
function raw(t:Tuple,c:Corpus,f:AttentionFeedMode):RawCalibrationPoint {
  return { tradingDate:c.dates[t[0]], symbol:c.symbols[t[1]], minuteOfDay:t[3], feedMode:f, subWindow:windowAt(t[3])!, participationInput:t[4], participationInputKind:t[5]===0?"z":"surprise_bits", displacementZ:t[7], idiosyncrasyZ:t[8], limitedHistory:t[16]===1 };
}
function observation(t:Tuple,c:Corpus,f:AttentionFeedMode,s:FeedAwareAttentionThresholdStore):AttentionHistoryObservation {
  const p=raw(t,c,f),set=s.sets[f][p.subWindow],score=scoreRawCalibrationPoint(p,set.normalization);
  return { symbol:p.symbol, at:t[2], score:score.attention, core:score.core, feedMode:f, subWindow:p.subWindow, calibrationId:set.calibrationId, participationBaselineMode:modeName[t[6]], participationInput:t[4], participationInputKind:t[5]===0?"z":"surprise_bits", displacementZ:t[7], idiosyncrasyZ:t[8], price:t[9], atr:t[10], vwap:t[11], ema9:t[12], consecutiveExpansionBars:t[13], pullbackObserved:t[14]===1, priceLostVwap:t[15]===1, dataQualityState:t[16]===1?"limited_history":"ok", provisional:false };
}
function dist(values:number[]):Dist {
  if(!values.length)return {count:0,min:null,p50:null,p75:null,p90:null,p95:null,p99:null,max:null};
  const sorted=[...values].sort((a,b)=>a-b);
  const q=(p:number)=>{const index=(sorted.length-1)*p,lower=Math.floor(index),weight=index-lower;return sorted[lower]+((sorted[lower+1]??sorted[lower])-sorted[lower])*weight;};
  return {count:sorted.length,min:sorted[0],p50:q(.5),p75:q(.75),p90:q(.9),p95:q(.95),p99:q(.99),max:sorted.at(-1)!};
}
function ratio(pass:number,total:number){return total?pass/total:0;}
function inc(map:Record<string,number>,key:string,n=1){map[key]=(map[key]??0)+n;}
function cloneStore(store:FeedAwareAttentionThresholdStore,label:string,values:Partial<{inPlayEnterCore:number;inPlayExitCore:number;exitPersistenceMinutes:number}>):FeedAwareAttentionThresholdStore {
  const next=structuredClone(store),set=next.sets.sip.regular;
  set.calibrationId=set.calibrationId+":diagnostic-"+label;
  set.values={...set.values,...values};
  set.provisionalValues={...set.provisionalValues,...values};
  return next;
}
function replay(c:Corpus,m:Manifest,store:FeedAwareAttentionThresholdStore,onFrame:(feed:AttentionFeedMode,session:Session,minute:number,frame:AttentionA3Frame)=>void,onlyFeed?:AttentionFeedMode,sessionDates?:ReadonlySet<string>,episodeRelativePullback=false){
  for(const feed of (onlyFeed?[onlyFeed]:feedModes)){
    const bySession=Array.from({length:m.sessions.length},()=>[] as Tuple[]);
    for(const tuple of c.feeds[feed])bySession[tuple[0]].push(tuple);
    for(let d=0;d<m.sessions.length;d++){
      const session=m.sessions[d];
      if(sessionDates&&!sessionDates.has(session.tradingDate))continue;
      const engine=new FastDiagnosticReplayEngine(store,episodeRelativePullback),byMinute=new Map<number,AttentionHistoryObservation[]>();
      for(const t of bySession[d]){
        if(!configured(session,t[3]))continue;
        const w=windowAt(t[3])!;
        if(store.sets[feed][w].calibrationStatus!=="calibrated")continue;
        const list=byMinute.get(t[3])??[];
        list.push(observation(t,c,feed,store));
        byMinute.set(t[3],list);
      }
      for(let minute=240;minute<1200;minute++){
        const list=byMinute.get(minute);
        if(list?.length)onFrame(feed,session,minute,engine.processMinute(list));
      }
    }
  }
}

class FastDiagnosticReplayEngine {
  private history: AttentionHistoryState | null = null;
  private symbols: Record<string,{state:any;episode:AttentionEpisode|null;cooling:any;pullback:any}> = {};
  private readonly rankable = new Set(rankableUniverse(ATTENTION_UNIVERSE).map(row=>row.symbol));
  constructor(private readonly store:FeedAwareAttentionThresholdStore,private readonly useEpisodeRelativePullback=false){assertFeedAwareAttentionThresholdStore(store);}
  processMinute(observations:readonly AttentionHistoryObservation[]):AttentionA3Frame {
    const eligible=observations.filter(row=>this.rankable.has(row.symbol));
    if(!eligible.length)throw new Error("Diagnostic replay requires a rankable observation.");
    const previousHistory=this.history,historyUpdate=updateAttentionHistory(previousHistory,eligible);
    this.history=historyUpdate.state;
    const rows:AttentionA3FrameRow[]=[];
    for(const point of historyUpdate.frame){
      const memory=this.symbols[point.symbol]??{state:null,episode:null,cooling:null,pullback:null};
      const symbolHistory=historyUpdate.state.bySymbol[point.symbol];
      const previousPoint=previousHistory?.bySymbol[point.symbol]?.at(-1)??null;
      const velocity=computeAttentionVelocity(symbolHistory);
      const cooling=updateAttentionCooling({previousMemory:memory.episode?.state==="completed"?null:memory.cooling,previousPoint,point,velocity});
      const set=this.store.sets[point.feedMode][point.subWindow];
      if(set.calibrationId!==point.calibrationId)throw new Error("Diagnostic calibration identity mismatch.");
      const thresholds=thresholdValuesForReplay(set);
      const stateUpdate=updateAttentionState({previous:memory.state,at:point.at,core:point.core,thresholds:thresholds.values,enterPersistenceMinutes:thresholds.values.enterPersistenceMinutes,exitPersistenceMinutes:thresholds.values.exitPersistenceMinutes,accelerationFailed:cooling.accelerationFailed});
      let episode=memory.episode;
      if(stateUpdate.transition?.from==="LOW_PRIORITY"&&stateUpdate.transition.to!=="LOW_PRIORITY")episode=startAttentionEpisode({history:symbolHistory,calibrationStore:this.store});
      if(episode)episode=updateAttentionEpisode({episode,point,attentionState:stateUpdate.memory.state,modeTransition:velocity.modeTransition,accelerationFailed:cooling.accelerationFailed});
      let pullback=memory.pullback;
      if(!episode||episode.state==="completed")pullback=null;
      else if(this.useEpisodeRelativePullback){
        if(!pullback||pullback.episodeId!==episode.episodeId){
          pullback={episodeId:episode.episodeId,start:episode.priceAtStart,high:episode.priceAtStart,low:episode.priceAtStart,observed:false};
          for(const sample of symbolHistory.filter(row=>row.at>=episode!.startedAt)){pullback.high=Math.max(pullback.high,sample.price);pullback.low=Math.min(pullback.low,sample.price);const up=pullback.high-pullback.start,down=pullback.start-pullback.low;if(up>=down)pullback.observed ||= up>=.5*sample.atr&&pullback.high-sample.price>=.3*sample.atr;else pullback.observed ||= down>=.5*sample.atr&&sample.price-pullback.low>=.3*sample.atr;}
        }else{pullback.high=Math.max(pullback.high,point.price);pullback.low=Math.min(pullback.low,point.price);const up=pullback.high-pullback.start,down=pullback.start-pullback.low;if(up>=down)pullback.observed ||= up>=.5*point.atr&&pullback.high-point.price>=.3*point.atr;else pullback.observed ||= down>=.5*point.atr&&point.price-pullback.low>=.3*point.atr;}
      }
      const freshnessPoint=this.useEpisodeRelativePullback&&pullback?{...point,pullbackObserved:pullback.observed}:point;
      const freshness=episode&&episode.state!=="completed"?classifyAttentionFreshness(episode,freshnessPoint):null;
      const statePersistenceMinutes=Math.floor((point.at-stateUpdate.memory.stateEnteredAt)/60000)+1;
      this.symbols[point.symbol]={state:stateUpdate.memory,episode,cooling:cooling.memory,pullback};
      rows.push({symbol:point.symbol,point,coreSmoothed:point.core,velocity,state:stateUpdate.memory.state,stateEnteredAt:stateUpdate.memory.stateEnteredAt,statePersistenceMinutes,pendingTransition:stateUpdate.memory.pendingTransition,pendingTransitionMinutes:stateUpdate.memory.pendingTransitionMinutes,stateExplanation:explainAttentionState(stateUpdate.memory,point.core,thresholds.values),transition:stateUpdate.transition,episode,freshness,cooling,thresholdCalibrationStatus:set.calibrationStatus,provisional:thresholds.provisional,conclusionsAllowed:thresholds.conclusionsAllowed});
    }
    assertAttentionStateFrameInvariants(rows.map(row=>{const values=thresholdValuesForReplay(this.store.sets[row.point.feedMode][row.point.subWindow]).values;return{symbol:row.symbol,feedMode:row.point.feedMode,subWindow:row.point.subWindow,core:row.point.core,memory:this.symbols[row.symbol].state,thresholds:values,enterPersistenceMinutes:values.enterPersistenceMinutes,exitPersistenceMinutes:values.exitPersistenceMinutes};}));
    const lists=buildAttentionLists(rows.map(row=>{const values=thresholdValuesForReplay(this.store.sets[row.point.feedMode][row.point.subWindow]).values;return{symbol:row.symbol,point:row.point,state:row.state,statePersistenceMinutes:row.statePersistenceMinutes,pendingTransition:row.pendingTransition,pendingTransitionMinutes:row.pendingTransitionMinutes,stateExplanation:row.stateExplanation,episode:row.episode,freshness:row.freshness,velocity:row.velocity,minimumVelocityPerMinute:values.newInPlayVelocityPerMinute,dataQualityState:row.point.dataQualityState};}),ATTENTION_UNIVERSE);
    const provisional=rows.some(row=>row.provisional);
    return{at:rows[0].point.at,rows,lists,provisional,conclusionsAllowed:!provisional&&rows.every(row=>row.conclusionsAllowed)};
  }
}
function main(){
  const root=resolve("data/replay/calibration"),reports=resolve("data/replay/reports");
  mkdirSync(reports,{recursive:true});
  const c=JSON.parse(gunzipSync(readFileSync(resolve(root,"raw-features.json.gz"))).toString("utf8")) as Corpus;
  const m=JSON.parse(readFileSync(resolve(root,"session-manifest.json"),"utf8")) as Manifest;
  const store=JSON.parse(readFileSync(resolve(reports,"attention-thresholds.json"),"utf8")) as FeedAwareAttentionThresholdStore;
  if(c.splitHash!==m.splitHash)throw new Error("Frozen split mismatch.");
  const proposalOnly=process.argv.includes("--proposal-only");
  const freshnessOnly=process.argv.includes("--freshness-only")||proposalOnly;
  const prior:any=freshnessOnly?JSON.parse(readFileSync(resolve(reports,"waking-up-diagnosis.json"),"utf8")):null;

  const velocity=new Map<string,{scoreDelta1m:number[];scoreDelta3m:number[];scoreDelta5m:number[];rollingZDelta5m:number[];derived:number[];above2:number;abovePublished:number;available:number;threshold:number}>();
  const gates=new Map<string,{total:number;independent:Record<string,number>;cumulative:Record<string,number>;actual:number;extra:Record<string,number>}>();
  const exitCost={full:{total:0,settled:0,pendingExit:0,scoreDecay:[] as number[]},displayed:{total:0,settled:0,pendingExit:0,scoreDecay:[] as number[]}};
  let backdateCandidates=0,backdateBlockedAtr=0,backdateBlockedFreshness=0,backdateChangedEligibility=0;
  let activePriceSessionKey: string | null = null;
  let activeSessionPrices = new Map<string,Map<number,number>>();

  if(!freshnessOnly) replay(c,m,store,(feed,session,minute,frame)=>{
    const w=windowAt(minute)!,key=feed+"|"+w,threshold=thresholdValuesForReplay(store.sets[feed][w]).values.newInPlayVelocityPerMinute;
    const v=velocity.get(key)??{scoreDelta1m:[],scoreDelta3m:[],scoreDelta5m:[],rollingZDelta5m:[],derived:[],above2:0,abovePublished:0,available:0,threshold};
    const g=gates.get(key)??{total:0,independent:{},cumulative:{},actual:0,extra:{}};
    const sessionKey=feed+"|"+session.tradingDate;
    if(activePriceSessionKey!==sessionKey){activePriceSessionKey=sessionKey;activeSessionPrices=new Map<string,Map<number,number>>();}
    const sessionPrices=activeSessionPrices;
    for(const row of frame.rows){
      const symbolPrices=sessionPrices.get(row.symbol)??new Map<number,number>();
      symbolPrices.set(row.point.at,row.point.price);
      sessionPrices.set(row.symbol,symbolPrices);
      if(row.velocity.scoreDelta1m!==null)v.scoreDelta1m.push(row.velocity.scoreDelta1m);
      if(row.velocity.scoreDelta3m!==null)v.scoreDelta3m.push(row.velocity.scoreDelta3m);
      if(row.velocity.scoreDelta5m!==null)v.scoreDelta5m.push(row.velocity.scoreDelta5m);
      if(row.velocity.rollingZDelta5m!==null)v.rollingZDelta5m.push(row.velocity.rollingZDelta5m);
      if(row.velocity.scoreVelocityPerMinute!==null){
        v.derived.push(row.velocity.scoreVelocityPerMinute);v.available++;
        if(row.velocity.scoreVelocityPerMinute>=2)v.above2++;
        if(row.velocity.scoreVelocityPerMinute>=threshold)v.abovePublished++;
      }

      g.total++;
      const fresh=row.freshness!==null&&(row.freshness.freshness==="Fresh"||row.freshness.freshness==="Developing");
      const atr=row.freshness!==null&&row.freshness.atrTravelledSinceStart<MAXIMUM_WAKING_ATR_TRAVEL;
      const score=row.point.score>=MINIMUM_WAKING_SCORE;
      const quality=row.point.dataQualityState==="ok"||row.point.dataQualityState==="limited_history";
      const persistence=row.statePersistenceMinutes>=MINIMUM_STATE_PERSISTENCE;
      const velocityPass=row.velocity.scoreVelocityPerMinute!==null&&row.velocity.scoreVelocityPerMinute>=threshold;
      const requested=[["freshness",fresh],["atrTravel",atr],["minimumScore",score],["dataQuality",quality],["persistence",persistence],["velocity",velocityPass]] as const;
      let cumulative=true;
      for(const [name,pass] of requested){if(pass)inc(g.independent,name);cumulative=cumulative&&pass;if(cumulative)inc(g.cumulative,name);}
      const eligibleState=row.state!=="LOW_PRIORITY"&&row.state!=="COOLING";
      const episodeActive=row.episode!==null&&row.episode.accelerationFailedAt===null;
      const guardClear=!row.velocity.velocityEventsSuppressed;
      if(eligibleState)inc(g.extra,"eligibleState");
      if(episodeActive)inc(g.extra,"activeEpisode");
      if(guardClear)inc(g.extra,"guardClear");
      if(fresh&&atr&&score&&quality&&persistence&&velocityPass&&eligibleState&&episodeActive&&guardClear)g.actual++;

      if(feed==="sip"&&w==="regular"&&row.episode&&row.freshness){
        const qualificationPrice=symbolPrices.get(row.episode.qualifiedAt);
        if(qualificationPrice!==undefined){
          const hypothetical=classifyAttentionFreshness({...row.episode,startedAt:row.episode.qualifiedAt,priceAtStart:qualificationPrice},row.point);
          const otherwise=score&&quality&&persistence&&velocityPass&&eligibleState&&episodeActive&&guardClear;
          if(otherwise){
            backdateCandidates++;
            const actualAtr=atr,hypAtr=hypothetical.atrTravelledSinceStart<MAXIMUM_WAKING_ATR_TRAVEL;
            const hypFresh=hypothetical.freshness==="Fresh"||hypothetical.freshness==="Developing";
            if(!actualAtr&&hypAtr)backdateBlockedAtr++;
            if(!fresh&&hypFresh)backdateBlockedFreshness++;
            if(!(fresh&&actualAtr)&&hypFresh&&hypAtr)backdateChangedEligibility++;
          }
        }
      }
    }
    const visible=new Set(frame.lists.inPlayDisplay.visibleRows.map(row=>row.symbol));
    for(const row of frame.lists.inPlay){
      const pending=row.pendingTransition==="exiting",decay=Math.max(0,(row.episode?.peakAttention??row.point.score)-row.point.score);
      exitCost.full.total++;if(pending)exitCost.full.pendingExit++;else exitCost.full.settled++;exitCost.full.scoreDecay.push(decay);
      if(visible.has(row.symbol)){exitCost.displayed.total++;if(pending)exitCost.displayed.pendingExit++;else exitCost.displayed.settled++;exitCost.displayed.scoreDecay.push(decay);}
    }
    velocity.set(key,v);
    gates.set(key,g);
  });
  if(!freshnessOnly) console.log("current diagnostic replay complete");

  const requestedVariant=process.argv.find(arg=>arg.startsWith("--variant="))?.split("=")[1]??null;
  const allVariants=[
    {id:"pre_usability",store:cloneStore(store,"pre-usability",{inPlayEnterCore:.7808,inPlayExitCore:.7658,exitPersistenceMinutes:2})},
    {id:"selected_with_exit_persistence_2",store:cloneStore(store,"p2-isolation",{inPlayEnterCore:.8,inPlayExitCore:.7,exitPersistenceMinutes:2})},
    {id:"accepted_exit_persistence_30",store},
  ];
  const variants=process.argv.includes("--current-only")||proposalOnly?[]:allVariants.filter(row=>requestedVariant===null||row.id===requestedVariant);
  const freshnessVariants:any[]=[];
  for(const variant of variants){
    const counts:Record<string,number>={Fresh:0,Developing:0,Mature:0,Extended:0};
    let activeEpisodeMinutes=0,wakingRows=0;
    replay(c,m,variant.store,(feed,_session,minute,frame)=>{
      if(feed!=="sip"||windowAt(minute)!=="regular")return;
      for(const row of frame.rows){
        if(row.episode&&row.episode.state!=="completed"&&row.freshness){inc(counts,row.freshness.freshness);activeEpisodeMinutes++;}
      }
      wakingRows+=0;
    },"sip");
    console.log("freshness variant complete: "+variant.id);
    freshnessVariants.push({id:variant.id,activeEpisodeMinutes,counts,fractions:Object.fromEntries(Object.entries(counts).map(([k,n])=>[k,ratio(n,activeEpisodeMinutes)])),wakingRows});
  }

  let proposal:any=null;
  if(proposalOnly){
    const selectedDates=new Set(["2025-10-01","2025-10-10","2025-11-04","2025-11-28","2026-02-13"]);
    const digest=new SipSessionDigestCollector(selectedDates);
    const perSession:Record<string,{wakingRows:number;minutes:Set<number>;events:any[]}>={};
    replay(c,m,store,(feed,session,minute,frame)=>{
      if(feed!=="sip")return;
      digest.observe(session,minute,frame);
      const state=perSession[session.tradingDate]??{wakingRows:0,minutes:new Set<number>(),events:[]};
      state.wakingRows+=0;
      if(0)state.minutes.add(minute);
      perSession[session.tradingDate]=state;
    },"sip",selectedDates,true);
    const rows=Object.entries(perSession).map(([tradingDate,state])=>({tradingDate,wakingRows:state.wakingRows,minutesWithWakingUp:state.minutes.size,events:state.events}));
    proposal={scope:"single_gate_counterfactual_not_published",change:"episode-relative directional pullback history only",excursionAtr:.5,retracementAtr:.3,rows,totalWakingRows:rows.reduce((sum,row)=>sum+row.wakingRows,0),totalMinutesWithWakingUp:rows.reduce((sum,row)=>sum+row.minutesWithWakingUp,0)};
    const eventLines=["","## Counterfactual WAKING UP rows (all minutes)","","| Date | Time ET | Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |","|---|---|---|---:|---:|---|---|---:|",...rows.flatMap(row=>row.events.map((event:any)=>"| "+row.tradingDate+" | "+String(Math.floor(event.minuteOfDay/60)).padStart(2,"0")+":"+String(event.minuteOfDay%60).padStart(2,"0")+" | "+event.symbol+" | "+event.attention.toFixed(1)+" | "+event.velocityPerMinute.toFixed(2)+" | "+event.state+" | "+event.freshness+" | "+event.atrTravelled.toFixed(2)+" |"))];
    writeFileSync(resolve(reports,"attention-session-digest-waking-proposal.md"),digest.markdown()+eventLines.join(String.fromCharCode(10)));
    writeFileSync(resolve(reports,"waking-up-proposal.json"),JSON.stringify(proposal,null,2)+String.fromCharCode(10));
    console.log("single-gate proposal replay complete");
  }
  const velocityRows:any[]=freshnessOnly?prior.velocityRows:[...velocity.entries()].map(([key,v])=>{
    const [feedMode,subWindow]=key.split("|");
    return {feedMode,subWindow,publishedVelocityThreshold:v.threshold,units:{scoreDelta1m:"attention-score points over 1 minute",scoreDelta3m:"attention-score points over 3 minutes",scoreDelta5m:"attention-score points over 5 minutes",rollingZDelta5m:"mean axis-z points over 5 minutes",scoreVelocityPerMinute:"scoreDelta3m / 3; falls back to 1m, then 5m / 5"},scoreDelta1m:dist(v.scoreDelta1m),scoreDelta3m:dist(v.scoreDelta3m),scoreDelta5m:dist(v.scoreDelta5m),rollingZDelta5m:dist(v.rollingZDelta5m),scoreVelocityPerMinute:dist(v.derived),fractionVelocityAtLeast2:ratio(v.above2,v.available),fractionVelocityAtLeastPublished:ratio(v.abovePublished,v.available)};
  }).sort((a,b)=>a.feedMode.localeCompare(b.feedMode)||ATTENTION_SUB_WINDOWS.indexOf(a.subWindow as AttentionSubWindow)-ATTENTION_SUB_WINDOWS.indexOf(b.subWindow as AttentionSubWindow));
  const gateRows:any[]=freshnessOnly?prior.gateRows:[...gates.entries()].map(([key,g])=>{
    const [feedMode,subWindow]=key.split("|");
    return {feedMode,subWindow,totalSymbolMinutes:g.total,independent:Object.fromEntries(Object.entries(g.independent).map(([k,n])=>[k,{count:n,fraction:ratio(n,g.total)}])),cumulative:Object.fromEntries(Object.entries(g.cumulative).map(([k,n])=>[k,{count:n,fraction:ratio(n,g.total)}])),extra:Object.fromEntries(Object.entries(g.extra).map(([k,n])=>[k,{count:n,fraction:ratio(n,g.total)}])),actualWakingRows:g.actual};
  }).sort((a,b)=>a.feedMode.localeCompare(b.feedMode)||ATTENTION_SUB_WINDOWS.indexOf(a.subWindow as AttentionSubWindow)-ATTENTION_SUB_WINDOWS.indexOf(b.subWindow as AttentionSubWindow));
  const exitSummary=freshnessOnly?prior.exitPersistenceCost:Object.fromEntries(Object.entries(exitCost).map(([k,v])=>[k,{total:v.total,settled:v.settled,pendingExit:v.pendingExit,fractionSettled:ratio(v.settled,v.total),fractionPendingExit:ratio(v.pendingExit,v.total),scoreDecayFromEpisodePeak:dist(v.scoreDecay)}]));
  const mergedFreshness=[...(prior?.freshnessVariants??[]).filter((old:any)=>!freshnessVariants.some((next:any)=>next.id===old.id)),...freshnessVariants];
  const backdating=freshnessOnly?prior.backdating:{otherwiseQualifyingMoments:backdateCandidates,blockedByActualAtrButNotQualificationAtr:backdateBlockedAtr,blockedByActualFreshnessButNotQualificationFreshness:backdateBlockedFreshness,eligibilityChangedByBackdating:backdateChangedEligibility};
  const artifact={schemaVersion:1,scope:"diagnosis_only_no_gate_changed",groundTruthValidation:"REFUSED",disclosure:PRE_STREAM_REPLAY_DISCLOSURE,corpusHash:c.splitHash,rawFeaturesSha256:sha256(readFileSync(resolve(root,"raw-features.json.gz"))),velocityRows,gateRows,freshnessVariants:mergedFreshness,backdating,exitPersistenceCost:exitSummary,proposal};
  const artifactHash=sha256(stableJson(artifact));
  writeFileSync(resolve(reports,"waking-up-diagnosis.json"),JSON.stringify({...artifact,artifactHash},null,2)+String.fromCharCode(10));
  console.log(JSON.stringify({artifactHash,velocityRows,gateRows,freshnessVariants:mergedFreshness,backdating:artifact.backdating,exitPersistenceCost:exitSummary},null,2));
}
main();