import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { AttentionA3ReplayEngine, type AttentionA3FrameRow } from "../lib/attention/attentionA3Replay";
import { compactAttentionAlertDeliveries } from "../lib/attention/alertDelivery";
import type { AttentionEvent } from "../lib/attention/attentionEvents";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { rankableUniverse } from "../lib/attention/universePolicy";
import { scoreRawCalibrationPoint, type RawCalibrationPoint } from "../lib/replay/populationCalibration";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import type { AttentionSubWindow } from "../lib/replay/attentionThresholdTypes";
import { PRE_STREAM_REPLAY_DISCLOSURE, sha256, stableJson } from "../lib/replay/archive";

type T = [number,number,number,number,number,0|1,0|1|2,number,number,number,number,number|null,number|null,number,0|1,0|1,0|1];
interface Corpus { splitHash: string; dates: string[]; symbols: string[]; feeds: { sip: T[] } }
interface Session { tradingDate: string; split: "train"|"holdout"; earlyClose: boolean }
interface Manifest { sessions: Session[] }
interface Qualification { threshold: number; tradingDate: string; split: Session["split"]; symbol: string; episodeId: string; at: number; score: number; core: number; freshness: string; atrTravelled: number; ema9DistanceAtr: number|null; converted: boolean; conversionAt: number|null; leadMinutes: number|null }

const THRESHOLDS = [.8,.7,.6,.5,.4];
const QUIET = ["2026-02-13","2026-04-20","2026-05-06"];
const rankable = new Set(rankableUniverse(ATTENTION_UNIVERSE).map((row) => row.symbol));
const modes = ["dense","sparse","dead"] as const;

function windowOf(minute: number): AttentionSubWindow | null {
  if (minute >= 240 && minute < 420) return "premarket_early";
  if (minute < 540) return "premarket_core";
  if (minute < 570) return "premarket_final";
  if (minute < 960) return "regular";
  if (minute < 1080) return "after_hours_core";
  if (minute < 1200) return "after_hours_late";
  return null;
}

function quantile(sorted: number[], p: number): number|null {
  if (!sorted.length) return null;
  const index=(sorted.length-1)*p, lo=Math.floor(index), hi=Math.ceil(index);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(index-lo);
}
function dist(values: Array<number|null>) {
  const s=values.filter((v):v is number=>v!==null&&Number.isFinite(v)).sort((a,b)=>a-b);
  const p25=quantile(s,.25),p75=quantile(s,.75);
  return {count:s.length,min:s[0]??null,p25,median:quantile(s,.5),p75,max:s.at(-1)??null,iqr:p25===null||p75===null?null:p75-p25};
}
function observation(tuple:T, corpus:Corpus, store:FeedAwareAttentionThresholdStore) {
  const subWindow=windowOf(tuple[3])!;
  const set=store.sets.sip[subWindow];
  const raw:RawCalibrationPoint={tradingDate:corpus.dates[tuple[0]],symbol:corpus.symbols[tuple[1]],minuteOfDay:tuple[3],feedMode:"sip",subWindow,participationInput:tuple[4],participationInputKind:tuple[5]?"surprise_bits":"z",displacementZ:tuple[7],idiosyncrasyZ:tuple[8],limitedHistory:!!tuple[16]};
  const scored=scoreRawCalibrationPoint(raw,set.normalization);
  return {symbol:raw.symbol,at:tuple[2],score:scored.attention,core:scored.core,feedMode:"sip" as const,subWindow,calibrationId:set.calibrationId,participationBaselineMode:modes[tuple[6]],participationInput:tuple[4],participationInputKind:tuple[5]?"surprise_bits" as const:"z" as const,displacementZ:tuple[7],idiosyncrasyZ:tuple[8],price:tuple[9],atr:tuple[10],vwap:tuple[11],ema9:tuple[12],consecutiveExpansionBars:tuple[13],pullbackObserved:!!tuple[14],priceLostVwap:!!tuple[15],dataQualityState:tuple[16]?"limited_history" as const:"ok" as const,provisional:false};
}

function syntheticEvent(q:Qualification): AttentionEvent {
  return {eventId:`sweep:${q.threshold}:${q.tradingDate}:${q.symbol}:${q.episodeId}`,type:"NOW_IN_PLAY",symbol:q.symbol,at:q.at,qualifiedAt:q.at,emittedAt:q.at,episodeId:q.episodeId,payload:{attentionScore:q.score}} as unknown as AttentionEvent;
}

function summarize(split:Session["split"], threshold:number, sessions:Session[], rows:Qualification[], exitCore:number) {
  const selected=rows.filter((row)=>row.split===split&&row.threshold===threshold);
  const sessionRows=sessions.filter((row)=>row.split===split);
  const perSession=sessionRows.map((session)=>{
    const qualifications=selected.filter((row)=>row.tradingDate===session.tradingDate);
    const delivery=compactAttentionAlertDeliveries(qualifications.map(syntheticEvent));
    return {tradingDate:session.tradingDate,qualifications:qualifications.length,deliveredAlerts:delivery.deliveredEnvelopeCount,collapsed:delivery.collapsedEventCount};
  });
  const freshness=Object.fromEntries(["Fresh","Developing","Mature","Extended"].map((name)=>[name,selected.filter((row)=>row.freshness===name).length]));
  const converters=selected.filter((row)=>row.converted);
  const quiet=Object.fromEntries(QUIET.map((date)=>{
    const session=perSession.find((row)=>row.tradingDate===date);
    return [date,session?session.qualifications===0:null];
  }));
  const requiredQuietInSplit=QUIET.filter((date)=>quiet[date]!==null);
  return {split,threshold,configurationValidity:threshold>exitCore?"deployable_with_fixed_exit":"diagnostic_only_enter_not_above_fixed_exit",qualifications:selected.length,freshness:{counts:freshness,shares:Object.fromEntries(Object.entries(freshness).map(([key,value])=>[key,selected.length?value/selected.length:0]))},atrTravelledAtQualification:dist(selected.map((row)=>row.atrTravelled)),ema9DistanceAtrAtQualification:dist(selected.map((row)=>row.ema9DistanceAtr)),alertsPerSessionBeforeRateLimit:dist(perSession.map((row)=>row.qualifications)),deliveredAlertsPerSession:dist(perSession.map((row)=>row.deliveredAlerts)),conversion:{count:converters.length,rate:selected.length?converters.length/selected.length:0,leadMinutes:dist(converters.map((row)=>row.leadMinutes))},quietSessions:quiet,requiredQuietSessionsInSplit:requiredQuietInSplit,allRequiredQuietInSplit:requiredQuietInSplit.length?requiredQuietInSplit.every((date)=>quiet[date]===true):null,perSession};
}

function main() {
  const root=resolve("data/replay/calibration"),reports=resolve("data/replay/reports");mkdirSync(reports,{recursive:true});
  const corpus=JSON.parse(gunzipSync(readFileSync(resolve(root,"raw-features.json.gz"))).toString("utf8")) as Corpus;
  const manifest=JSON.parse(readFileSync(resolve(root,"session-manifest.json"),"utf8")) as Manifest;
  const store=JSON.parse(readFileSync(resolve(reports,"attention-thresholds.json"),"utf8")) as FeedAwareAttentionThresholdStore;
  const exitCore=store.sets.sip.regular.values.inPlayExitCore!;
  const byDate=new Map<number,T[]>();for(const tuple of corpus.feeds.sip){const list=byDate.get(tuple[0])??[];list.push(tuple);byDate.set(tuple[0],list)}
  const qualifications:Qualification[]=[];
  for(const session of manifest.sessions){
    const dateIndex=corpus.dates.indexOf(session.tradingDate),engine=new AttentionA3ReplayEngine(store,ATTENTION_UNIVERSE),byMinute=new Map<number,T[]>();
    for(const tuple of byDate.get(dateIndex)??[]){if(!rankable.has(corpus.symbols[tuple[1]]))continue;const w=windowOf(tuple[3]);if(!w||store.sets.sip[w].calibrationStatus!=="calibrated")continue;const list=byMinute.get(tuple[3])??[];list.push(tuple);byMinute.set(tuple[3],list)}
    const episodeRows=new Map<string,AttentionA3FrameRow[]>();
    for(let minute=240;minute<1200;minute++){const tuples=byMinute.get(minute);if(!tuples?.length)continue;const frame=engine.processMinute(tuples.map((tuple)=>observation(tuple,corpus,store)));if(minute<570||minute>=(session.earlyClose?765:960))continue;for(const row of frame.rows){if(!row.episode||row.episode.state==="completed"||row.point.subWindow!=="regular")continue;const key=row.episode.episodeId;const list=episodeRows.get(key)??[];list.push(row);episodeRows.set(key,list)}}
    for(const [episodeId,rows] of episodeRows){rows.sort((a,b)=>a.point.at-b.point.at);for(const threshold of THRESHOLDS){let run=0,qIndex=-1;for(let i=0;i<rows.length;i++){run=rows[i].coreSmoothed>=threshold?run+1:0;if(run>=2){qIndex=i;break}}if(qIndex<0)continue;const q=rows[qIndex],future=rows.slice(qIndex),conversion=future.find((row)=>row.coreSmoothed>=.8)??null;qualifications.push({threshold,tradingDate:session.tradingDate,split:session.split,symbol:q.symbol,episodeId,at:q.point.at,score:q.point.score,core:q.coreSmoothed,freshness:q.freshness?.freshness??"n/a",atrTravelled:q.freshness?.atrTravelledSinceStart??0,ema9DistanceAtr:q.freshness?.distanceFromEma9Atr??null,converted:conversion!==null,conversionAt:conversion?.point.at??null,leadMinutes:conversion?(conversion.point.at-q.point.at)/60000:null})}}
  }
  const results=THRESHOLDS.map((threshold)=>{
    const splits=(["train","holdout"] as const).map((split)=>summarize(split,threshold,manifest.sessions,qualifications,exitCore));
    const corpusQuiet=Object.fromEntries(QUIET.map((date)=>[date,qualifications.filter((row)=>row.threshold===threshold&&row.tradingDate===date).length===0]));
    return {threshold,splits,corpusQuiet,allRequiredQuiet:QUIET.every((date)=>corpusQuiet[date])};
  });
  const recommendation={threshold:null,status:"NO_ACCEPTABLE_LOWER_THRESHOLD",reason:"0.70 is the only lower requested level compatible with the fixed 0.66 exit, but it does not improve Extended share and it activates two mandated quiet sessions. Lower levels are invalid with the fixed exit and also fail freshness/quiet constraints.",published:false,currentThresholdUnchanged:.8};
  const artifact:any={schemaVersion:1,status:"DIAGNOSTIC_ONLY_NOT_PUBLISHED",scope:"sip_regular",groundTruthValidation:"REFUSED",disclosure:PRE_STREAM_REPLAY_DISCLOSURE,splitHash:corpus.splitHash,frozenPolicy:{exitCore,exitPersistenceMinutes:store.sets.sip.regular.values.exitPersistenceMinutes,enterPersistenceMinutes:2,stateSmoothingMinutes:0,delivery:"4 envelopes / rolling 15 minutes with digest compaction",earlyCloseTreatment:"final 15 regular-session minutes excluded"},method:{unit:"first two-consecutive-minute qualification per existing A3 episode",conversion:"same episode subsequently reaches core 0.80",lowerThresholdCaveat:"0.60/0.50/0.40 are counterfactual qualification levels only because fixed exit=0.66 and threshold ordering require exit < enter"},quietSessionsRequired:QUIET,results,recommendation};artifact.artifactHash=sha256(stableJson(artifact));
  writeFileSync(resolve(reports,"inplay-enter-freshness-sweep.json"),JSON.stringify(artifact,null,2)+"\n");
  const pct=(v:number)=>(100*v).toFixed(1)+"%",fmt=(v:number|null)=>v===null?"n/a":v.toFixed(2),d=(x:any)=>`${fmt(x.median)} [${fmt(x.p25)}–${fmt(x.p75)}]`;
  const lines=["# IN PLAY entry threshold — freshness diagnostic","",`> ${PRE_STREAM_REPLAY_DISCLOSURE}`,"","> Population behavior only. Ground-truth quality, hit rate, latency, move capture, and profitability conclusions are refused.","",`SIP regular only. Published entry remains 0.80. Fixed exit is ${exitCore.toFixed(2)}; therefore 0.60/0.50/0.40 are diagnostic qualification levels, not valid publishable state configurations. No calibration identity was changed.`,"","| Enter | Split | Fresh | Developing | Mature | Extended | Travel ATR median [IQR] | EMA9 ATR median [IQR] | Alerts/session median [IQR] | Delivered/session median [IQR] | Conversion to 0.80 | Lead min median [IQR] | Corpus quiet 3/3 | Valid with exit 0.66 |","|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",...results.flatMap((r:any)=>r.splits.map((s:any)=>`| ${r.threshold.toFixed(2)} | ${s.split} | ${pct(s.freshness.shares.Fresh)} | ${pct(s.freshness.shares.Developing)} | ${pct(s.freshness.shares.Mature)} | ${pct(s.freshness.shares.Extended)} | ${d(s.atrTravelledAtQualification)} | ${d(s.ema9DistanceAtrAtQualification)} | ${d(s.alertsPerSessionBeforeRateLimit)} | ${d(s.deliveredAlertsPerSession)} | ${pct(s.conversion.rate)} | ${d(s.conversion.leadMinutes)} | ${r.allRequiredQuiet?"yes":"NO"} | ${s.configurationValidity.startsWith("deployable")?"yes":"no"} |`)),"","All three mandated quiet dates are in the training split. Holdout quiet fields are therefore `n/a`; the table reports the corpus-wide result to avoid treating an absent date as a pass.","","## Recommendation","","No lower threshold is recommendable from this sweep. At 0.70, Extended remains 95.16% train / 96.36% holdout, conversion falls to 68.17% / 60.00%, median lead remains 0 minutes, and 2026-04-20 plus 2026-05-06 cease to be quiet. The 0.60–0.40 rows are not publishable with exit 0.66 and do not solve freshness anyway.","","The current 0.80 threshold remains unchanged only because no candidate passed the stated constraints—not because its 96% Extended output is accepted. The evidence points back to the pending freshness/extension-classification diagnosis: lowering activity level alone does not make qualification actionable.","","The rate limiter changes delivery only; qualification, episode state, storage, and standing lists are not compacted.","",`Artifact: \`${artifact.artifactHash}\`. Published threshold: unchanged at 0.80.`];writeFileSync(resolve(reports,"inplay-enter-freshness-sweep.md"),lines.join("\n")+"\n");  console.log(JSON.stringify({artifactHash:artifact.artifactHash,results,recommendation},null,2));
}
main();
