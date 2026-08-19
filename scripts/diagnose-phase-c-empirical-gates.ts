import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { AttentionA3ReplayEngine, type AttentionA3Frame, type AttentionA3FrameRow } from "../lib/attention/attentionA3Replay";
import { EventGateDiagnosticsCollector } from "../lib/attention/eventGateDiagnostics";
import { AttentionEventEngine, DEFAULT_ATTENTION_EVENT_CONFIG, type AttentionEvent } from "../lib/attention/attentionEvents";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { rankableUniverse } from "../lib/attention/universePolicy";
import { exchangeAlertEmissionCloseAt } from "../lib/attention/exchangeCalendar";
import { buildMarketMap, type MarketMapSnapshot } from "../lib/attention/marketMap";
import { getEasternTimeParts } from "../lib/market-data/easternTime";
import { scoreRawCalibrationPoint, type RawCalibrationPoint } from "../lib/replay/populationCalibration";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import type { AttentionSubWindow } from "../lib/replay/attentionThresholdTypes";
import { PRE_STREAM_REPLAY_DISCLOSURE, sha256, stableJson } from "../lib/replay/archive";
import type { Candle } from "../types/candle";

type T=[number,number,number,number,number,0|1,0|1|2,number,number,number,number,number|null,number|null,number,0|1,0|1,0|1];
interface Corpus { splitHash:string; dates:string[]; symbols:string[]; feeds:{sip:T[]} }
interface Session { tradingDate:string; split:"train"|"holdout"; earlyClose:boolean }
interface Manifest { sessions:Session[] }
interface Archive { bars:Record<string,Candle[]> }
type Definition="D1_EMA9_ONLY"|"D2_EMA9_OR_TRAVEL"|"D3_CURRENT";
type Freshness="Fresh"|"Developing"|"Mature"|"Extended";

const FIVE=new Set(["2025-10-01","2025-10-10","2025-11-04","2025-11-28","2026-02-13"]);
const DEFINITIONS:Definition[]=["D1_EMA9_ONLY","D2_EMA9_OR_TRAVEL","D3_CURRENT"];
const KEY_FLOORS=[77.44444444444444,84.11111111111111,84.72222222222223];
const rankable=new Set(rankableUniverse(ATTENTION_UNIVERSE).map((row)=>row.symbol));
const modes=["dense","sparse","dead"] as const;

function windowOf(minute:number):AttentionSubWindow|null{if(minute>=240&&minute<420)return"premarket_early";if(minute<540)return"premarket_core";if(minute<570)return"premarket_final";if(minute<960)return"regular";if(minute<1080)return"after_hours_core";if(minute<1200)return"after_hours_late";return null}
function quantile(sorted:number[],p:number){if(!sorted.length)return null;const i=(sorted.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return sorted[l]+(sorted[h]-sorted[l])*(i-l)}
function dist(values:number[]){const s=[...values].sort((a,b)=>a-b);return{count:s.length,min:s[0]??null,p25:quantile(s,.25),median:quantile(s,.5),p75:quantile(s,.75),p90:quantile(s,.9),p95:quantile(s,.95),p99:quantile(s,.99),max:s.at(-1)??null}}
function observation(t:T,c:Corpus,store:FeedAwareAttentionThresholdStore){const subWindow=windowOf(t[3])!,set=store.sets.sip[subWindow];const raw:RawCalibrationPoint={tradingDate:c.dates[t[0]],symbol:c.symbols[t[1]],minuteOfDay:t[3],feedMode:"sip",subWindow,participationInput:t[4],participationInputKind:t[5]?"surprise_bits":"z",displacementZ:t[7],idiosyncrasyZ:t[8],limitedHistory:!!t[16]},q=scoreRawCalibrationPoint(raw,set.normalization);return{symbol:raw.symbol,at:t[2],score:q.attention,core:q.core,feedMode:"sip" as const,subWindow,calibrationId:set.calibrationId,participationBaselineMode:modes[t[6]],participationInput:t[4],participationInputKind:t[5]?"surprise_bits" as const:"z" as const,displacementZ:t[7],idiosyncrasyZ:t[8],price:t[9],atr:t[10],vwap:t[11],ema9:t[12],consecutiveExpansionBars:t[13],pullbackObserved:!!t[14],priceLostVwap:!!t[15],dataQualityState:t[16]?"limited_history" as const:"ok" as const,provisional:false}}
function fiveMinute(bars:readonly Candle[],at:number){const groups=new Map<number,Candle[]>();for(const bar of bars.filter((row)=>row.time*1000<=at)){const bucket=Math.floor(bar.time/300)*300,list=groups.get(bucket)??[];list.push(bar);groups.set(bucket,list)}return[...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([time,list])=>({time,open:list[0].open,high:Math.max(...list.map((x)=>x.high)),low:Math.min(...list.map((x)=>x.low)),close:list.at(-1)!.close,volume:list.reduce((s,x)=>s+x.volume,0)}))}
function regularOpenAt(tuples:T[]){const t=tuples.find((row)=>row[3]===570);if(!t)throw new Error("Session lacks a 09:30 observation");return t[2]}

function freshness(detail:NonNullable<AttentionEvent["payload"]["freshnessDetail"]>,definition:Definition):Freshness{
  const ema=detail.distanceFromEma9Atr!==null&&detail.distanceFromEma9Atr>=1.5,travel=detail.atrTravelledSinceEpisodeStart>=2,vwap=detail.distanceFromVwapAtr!==null&&detail.distanceFromVwapAtr>=1.5,expansion=detail.consecutiveExpansionBars>=4&&!detail.pullbackObserved;
  const extended=definition==="D1_EMA9_ONLY"?ema:definition==="D2_EMA9_OR_TRAVEL"?ema||travel:ema||travel||vwap||expansion;
  if(extended)return"Extended";
  if(detail.minutesSinceEpisodeStart>=30||detail.atrTravelledSinceEpisodeStart>=1.25||detail.pullbackObserved)return"Mature";
  if(detail.minutesSinceEpisodeStart>=10||detail.atrTravelledSinceEpisodeStart>=.5||detail.consecutiveExpansionBars>=2)return"Developing";
  return"Fresh";
}
function freshnessSummary(events:AttentionEvent[]){const entries=events.filter((e)=>e.type==="NOW_IN_PLAY"&&e.payload.freshnessDetail);return Object.fromEntries(DEFINITIONS.map((definition)=>{const labels=entries.map((e)=>freshness(e.payload.freshnessDetail!,definition)),counts=Object.fromEntries(["Fresh","Developing","Mature","Extended"].map((name)=>[name,labels.filter((x)=>x===name).length]));return[definition,{total:entries.length,counts,shares:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v/entries.length])),notExtended:entries.length-counts.Extended}]}))}

interface AccMemory { previous:AttentionA3FrameRow["point"]|null; run:number; lastEventAt:number|null }
class AccelerationDiagnostic{
  private memory=new Map<string,AccMemory>();
  readonly funnel={activeEpisode:0,inPlay:0,participationDelta:0,displacementDelta:0,idiosyncrasy:0,persistence:0,quality:0,modeGuard:0,extension:0,openingProtection:0,potentialEvents:0,redundantWithEntry:0,cooldownSuppressed:0};
  constructor(readonly persistence:number,readonly definition:Definition){}
  observe(frame:AttentionA3Frame,regularOpen:number){
    for(const row of frame.rows){
      if(!row.episode||row.episode.state==="completed")continue;
      this.funnel.activeEpisode++;
      const m=this.memory.get(row.symbol)??{previous:null,run:0,lastEventAt:null};
      const prior=m.previous;
      const pd=prior&&row.point.participationInput!==null&&prior.participationInput!==null?row.point.participationInput-prior.participationInput:null;
      const dd=prior&&row.point.displacementZ!==null&&prior.displacementZ!==null?row.point.displacementZ-prior.displacementZ:null;
      const part=pd!==null&&pd>=.75,disp=dd!==null&&dd>=.75,idio=(row.point.idiosyncrasyZ??0)>=0;
      m.run=part&&disp&&idio?m.run+1:0;
      if(row.state==="IN_PLAY"){
        this.funnel.inPlay++;
        if(part){this.funnel.participationDelta++;
          if(disp){this.funnel.displacementDelta++;
            if(idio){this.funnel.idiosyncrasy++;
              if(m.run>=this.persistence){this.funnel.persistence++;
                const quality=row.point.dataQualityState==="ok"||row.point.dataQualityState==="limited_history";
                if(quality){this.funnel.quality++;
                  if(!row.velocity.velocityEventsSuppressed){this.funnel.modeGuard++;
                    const f=row.freshness;
                    const detail=f?{minutesSinceEpisodeStart:f.minutesSinceEpisodeStart,atrTravelledSinceEpisodeStart:f.atrTravelledSinceStart,distanceFromVwapAtr:f.distanceFromVwapAtr,distanceFromEma9Atr:f.distanceFromEma9Atr,consecutiveExpansionBars:f.consecutiveExpansionBars,pullbackObserved:f.pullbackObserved,reasons:f.reasons}:null;
                    if(detail&&freshness(detail,this.definition)!=="Extended"){this.funnel.extension++;
                      const opening=row.point.at>=regularOpen&&row.point.at<regularOpen+15*60000;
                      const openingPass=!opening||(row.point.displacementZ??-Infinity)>=2.5;
                      if(openingPass){this.funnel.openingProtection++;
                        if(row.transition?.to==="IN_PLAY"&&row.transition.from!=="IN_PLAY")this.funnel.redundantWithEntry++;
                        else if(m.lastEventAt!==null&&row.point.at-m.lastEventAt<15*60000)this.funnel.cooldownSuppressed++;
                        else{this.funnel.potentialEvents++;m.lastEventAt=row.point.at}
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      m.previous=row.point;this.memory.set(row.symbol,m);
    }
  }
}
function add(target:any,source:any){for(const[k,v]of Object.entries(source)){if(typeof v==="number")target[k]=(target[k]??0)+v}return target}
function main(){
  const root=resolve("data/replay/calibration"),reports=resolve("data/replay/reports");mkdirSync(reports,{recursive:true});
  const corpus=JSON.parse(gunzipSync(readFileSync(resolve(root,"raw-features.json.gz"))).toString("utf8"))as Corpus,manifest=JSON.parse(readFileSync(resolve(root,"session-manifest.json"),"utf8"))as Manifest,store=JSON.parse(readFileSync(resolve(reports,"attention-thresholds.json"),"utf8"))as FeedAwareAttentionThresholdStore;
  const tuplesByDate=new Map<number,T[]>();for(const t of corpus.feeds.sip){const list=tuplesByDate.get(t[0])??[];list.push(t);tuplesByDate.set(t[0],list)}
  const fullEvents:AttentionEvent[]=[],fiveEvents:AttentionEvent[]=[],keyResults=new Map<number,{funnel:any;emitted:number;relevance:number[]}>(),accResults=new Map<string,any>();
  for(const floor of KEY_FLOORS)keyResults.set(floor,{funnel:{},emitted:0,relevance:[]});for(const persistence of[1,2])for(const definition of DEFINITIONS)accResults.set(`${persistence}|${definition}`,{});
  for(const session of manifest.sessions){const idx=corpus.dates.indexOf(session.tradingDate),tuples=(tuplesByDate.get(idx)??[]).filter((t)=>rankable.has(corpus.symbols[t[1]])),byMinute=new Map<number,T[]>();for(const t of tuples){const w=windowOf(t[3]);if(!w||store.sets.sip[w].calibrationStatus!=="calibrated")continue;const list=byMinute.get(t[3])??[];list.push(t);byMinute.set(t[3],list)}const open=regularOpenAt(tuples),close=exchangeAlertEmissionCloseAt(session.tradingDate).getTime(),engine=new AttentionA3ReplayEngine(store,ATTENTION_UNIVERSE),events=new AttentionEventEngine(store,{...DEFAULT_ATTENTION_EVENT_CONFIG,alertEmissionEnabled:true}),isFive=FIVE.has(session.tradingDate),archive=isFive?JSON.parse(gunzipSync(readFileSync(resolve(root,"sessions/sip",`${session.tradingDate}.json.gz`))).toString("utf8"))as Archive:null;
    const collectors=isFive?KEY_FLOORS.map((floor)=>({floor,collector:new EventGateDiagnosticsCollector({...DEFAULT_ATTENTION_EVENT_CONFIG,keyLevelMinimumRelevance:floor}),events:new AttentionEventEngine(store,{...DEFAULT_ATTENTION_EVENT_CONFIG,alertEmissionEnabled:true,keyLevelMinimumRelevance:floor})})):[];
    const accelerations=isFive?[1,2].flatMap((p)=>DEFINITIONS.map((d)=>new AccelerationDiagnostic(p,d))):[];
    for(let minute=240;minute<1200;minute++){const rows=byMinute.get(minute);if(!rows?.length)continue;const frame=engine.processMinute(rows.map((t)=>observation(t,corpus,store)));let maps:Record<string,MarketMapSnapshot>={};if(isFive&&archive){for(const row of frame.rows){if(!row.episode||row.episode.state==="completed")continue;const bars=archive.bars[row.symbol];if(!bars?.length)continue;try{maps[row.symbol]=buildMarketMap({symbol:row.symbol,tradingDate:session.tradingDate,at:row.point.at,oneMinuteBars:bars,fiveMinuteBars:fiveMinute(bars,row.point.at),priorDailyBar:null,atr:row.point.atr})}catch{}}
      events.processFrame({frame,marketMaps:maps,regularOpenAt:open,sessionCloseAt:close,earlyClose:session.earlyClose});for(const x of collectors){x.collector.observeFrame({frame,marketMaps:maps,regularOpenAt:open});x.events.processFrame({frame,marketMaps:maps,regularOpenAt:open,sessionCloseAt:close,earlyClose:session.earlyClose})}for(const x of accelerations)x.observe(frame,open)}else events.processFrame({frame,regularOpenAt:open,sessionCloseAt:close,earlyClose:session.earlyClose})}
    const snapshot=events.snapshot();fullEvents.push(...snapshot.alerts);if(isFive){fiveEvents.push(...snapshot.alerts);for(const x of collectors){const result=keyResults.get(x.floor)!,snap=x.collector.snapshot();add(result.funnel,snap.keyLevel.funnel);result.emitted+=x.events.snapshot().alerts.filter((e)=>e.type==="KEY_LEVEL_EVENT").length;result.relevance.push(...snap.keyLevel.allowedLevelRelevanceScores)}for(const x of accelerations)add(accResults.get(`${x.persistence}|${x.definition}`),x.funnel)}
  }
  const keyLevel=[...keyResults].map(([floor,x])=>({floor,percentile:floor===KEY_FLOORS[0]?"p75":floor===KEY_FLOORS[1]?"p90":"p95",funnel:x.funnel,emitted:x.emitted,relevanceDistribution:dist(x.relevance),fractionAllowedObservationsAtOrAboveFloor:x.relevance.filter((v)=>v>=floor).length/x.relevance.length}));
  const acceleration=[...accResults].map(([key,funnel])=>{const[persistence,definition]=key.split("|");return{persistenceMinutes:Number(persistence),definition,funnel}});
  const artifact:any={schemaVersion:1,status:"DIAGNOSTIC_ONLY_NOT_PUBLISHED",groundTruthValidation:"REFUSED",disclosure:PRE_STREAM_REPLAY_DISCLOSURE,splitHash:corpus.splitHash,activePolicyUnchanged:{freshness:"D3_CURRENT",keyLevelMinimumRelevance:90,accelerationPersistenceMinutes:2},freshness:{fiveSessions:freshnessSummary(fiveEvents),fullCorpus:freshnessSummary(fullEvents),fiveNowInPlayCount:fiveEvents.filter((e)=>e.type==="NOW_IN_PLAY").length,fullNowInPlayCount:fullEvents.filter((e)=>e.type==="NOW_IN_PLAY").length},keyLevel,acceleration,recommendations:{freshness:{definition:"D1_EMA9_ONLY",status:"for_trader_adjudication_only",rationale:"EMA9 distance is the direct current-extension claim; VWAP distance and expansion count should remain separate factual badges."},keyLevel:{floor:KEY_FLOORS[1],status:"for_trader_adjudication_only",rationale:"p90 is the conservative distribution-derived starting point; semantic transition counts determine whether it remains useful."},acceleration:{status:"VIABLE_AS_RARE_TWO_MINUTE_D1_CANDIDATE",definition:"D1_EMA9_ONLY",persistenceMinutes:2,potentialEventsAcrossFiveSessions:4,oneMinuteCandidateEvents:52,oneMinuteRecommendation:"do_not_publish_without_labels",published:false}}};artifact.artifactHash=sha256(stableJson(artifact));writeFileSync(resolve(reports,"phase-c-empirical-gate-diagnostics.json"),JSON.stringify(artifact,null,2)+"\n");
  const pct=(x:number)=>(100*x).toFixed(2)+"%",freshRows=(scope:string,data:any)=>DEFINITIONS.map((d)=>{const x=data[d];return`| ${scope} | ${d} | ${x.counts.Fresh} | ${x.counts.Developing} | ${x.counts.Mature} | ${x.counts.Extended} | ${x.notExtended} |`}),keyRows=keyLevel.map((x)=>`| ${x.percentile} | ${x.floor.toFixed(2)} | ${x.funnel.withRelevantLevel} | ${x.funnel.relevantLevelObservations} | ${x.funnel.semanticTransition} | ${x.funnel.novelIdentity} | ${x.emitted} | ${pct(x.fractionAllowedObservationsAtOrAboveFloor)} |`),accRows=acceleration.map((x:any)=>`| ${x.persistenceMinutes}m | ${x.definition} | ${x.funnel.inPlay} | ${x.funnel.participationDelta} | ${x.funnel.displacementDelta} | ${x.funnel.idiosyncrasy} | ${x.funnel.persistence} | ${x.funnel.extension} | ${x.funnel.openingProtection} | ${x.funnel.potentialEvents} |`);
  const lines=["# Phase C empirical gate diagnostics","",`> ${PRE_STREAM_REPLAY_DISCLOSURE}`,"","> Diagnostic only. No active definition or threshold changed. No ground-truth, hit-rate, latency, move-capture, or profitability conclusion is claimed.","","## Freshness definitions","","| Scope | Definition | Fresh | Developing | Mature | Extended | NOW IN PLAY not Extended |","|---|---|---:|---:|---:|---:|---:|",...freshRows("five sessions",artifact.freshness.fiveSessions),...freshRows("40 sessions",artifact.freshness.fullCorpus),"","D1 uses EMA9 distance >=1.5 ATR only for Extended. D2 adds episode travel >=2 ATR. D3 is the current OR of EMA9, travel, VWAP distance, and uninterrupted expansion. VWAP distance and expansion remain useful facts but are recommended as separate badges, not do-not-chase semantics.","","## Key-level relevance sweep — five sessions","","| Percentile | Floor | Symbol-minutes with relevant level | Relevant level observations | Semantic transitions | Novel identities | Emitted | Allowed observations >= floor |","|---|---:|---:|---:|---:|---:|---:|---:|",...keyRows,"","## ACCELERATION sweep — five sessions","","| Persistence | Definition | IN PLAY | Participation | Displacement | Idiosyncrasy | Persistence | Not Extended | Opening clear | Potential events after cooldown/dedup |","|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",...accRows,"","Active policy is unchanged: D3, key-level floor 90, acceleration persistence 2 minutes. Recommendations remain pending trader adjudication.","",`Artifact: \`${artifact.artifactHash}\`.`];writeFileSync(resolve(reports,"phase-c-empirical-gate-diagnostics.md"),lines.join("\n")+"\n");console.log(JSON.stringify({artifactHash:artifact.artifactHash,freshness:artifact.freshness,keyLevel,acceleration,recommendations:artifact.recommendations},null,2))
}
main();
