import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { capAttentionDisplay } from "../lib/attention/attentionLists";
import { updateAttentionState, type AttentionStateMemory } from "../lib/attention/attentionState";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { buildClusterDisplay, rankableUniverse } from "../lib/attention/universePolicy";
import { scoreRawCalibrationPoint, type RawCalibrationPoint } from "../lib/replay/populationCalibration";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import { PRE_STREAM_REPLAY_DISCLOSURE, sha256, stableJson } from "../lib/replay/archive";

type T = [number,number,number,number,number,0|1,0|1|2,number,number,number,number,number|null,number|null,number,0|1,0|1,0|1];
interface Corpus { splitHash:string; dates:string[]; symbols:string[]; feeds:{sip:T[]} }
interface Session { tradingDate:string; split:"train"|"holdout"; earlyClose:boolean }
interface Manifest { splitHash:string; sessions:Session[] }
interface Point { date:string; split:"train"|"holdout"; minute:number; at:number; symbol:string; score:number; core:number }
interface Scenario { exitCore:number; exitPersistence:number }
interface Distribution { count:number; min:number|null; p25:number|null; median:number|null; p75:number|null; max:number|null; iqr:number|null }
interface Lifecycle { id:string; state:"active"|"cooling"|"completed"; coolingStartedAt:number|null; reentries:number; peakScore:number; peakMinute:number; display:Set<number> }

function quantile(values:readonly number[], p:number):number|null { if(!values.length)return null; const s=[...values].sort((a,b)=>a-b),position=(s.length-1)*p,lower=Math.floor(position),upper=Math.ceil(position); return s[lower]+(s[upper]-s[lower])*(position-lower); }
const COOLING_TIMEOUT_MINUTES = 45;
const rankable = new Set(rankableUniverse(ATTENTION_UNIVERSE).map((row) => row.symbol));
function dist(values:number[]):Distribution { if(!values.length)return{count:0,min:null,p25:null,median:null,p75:null,max:null,iqr:null}; const s=[...values].sort((a,b)=>a-b),p25=quantile(s,.25)!,p75=quantile(s,.75)!; return{count:s.length,min:s[0],p25,median:quantile(s,.5)!,p75,max:s.at(-1)!,iqr:p75-p25}; }
function runs(values:number[]):number[]{ if(!values.length)return[]; const s=[...new Set(values)].sort((a,b)=>a-b),out:number[]=[]; let run=1; for(let i=1;i<s.length;i++){if(s[i]===s[i-1]+1)run++;else{out.push(run);run=1}}out.push(run);return out; }
function evaluate(points:Map<string,Point[]>, sessions:Session[], base:any, scenario:Scenario){
  const perSession:any[]=[];
  for(const session of sessions){
    const byMinute=new Map<number,Point[]>(); for(const point of points.get(session.tradingDate)??[]){const list=byMinute.get(point.minute)??[];list.push(point);byMinute.set(point.minute,list)}
    const states=new Map<string,AttentionStateMemory>(),peaks=new Map<string,number>(),lifecycles=new Map<string,Lifecycle>(),seq=new Map<string,number>(),displayed=new Map<string,number[]>();
    const displayRows:{pending:boolean;decay:number}[]=[]; let minutesWithInPlay=0,transitionCount=0;
    const end=session.earlyClose?780:960;
    for(let minute=570;minute<end;minute++){
      const inPlay:{symbol:string;score:number;pending:boolean;decay:number;episodeKey:string}[]=[];
      for(const point of byMinute.get(minute)??[]){
        let lifecycle=lifecycles.get(point.symbol);
        if(lifecycle?.state==="cooling"&&lifecycle.coolingStartedAt!==null&&point.at-lifecycle.coolingStartedAt>=COOLING_TIMEOUT_MINUTES*60000){lifecycle.state="completed"}
        const previous=states.get(point.symbol)??null;
        const update=updateAttentionState({previous,at:point.at,core:point.core,thresholds:{...base,inPlayExitCore:scenario.exitCore},enterPersistenceMinutes:base.enterPersistenceMinutes,exitPersistenceMinutes:scenario.exitPersistence});
        states.set(point.symbol,update.memory); if(update.transition)transitionCount++;
        if(update.transition?.to==="IN_PLAY"&&update.transition.from!=="IN_PLAY"){
          if(!lifecycle||lifecycle.state==="completed"){
            const n=(seq.get(point.symbol)??0)+1;seq.set(point.symbol,n);lifecycle={id:`${point.symbol}:${n}`,state:"active",coolingStartedAt:null,reentries:0,peakScore:point.score,peakMinute:minute,display:new Set()};lifecycles.set(point.symbol,lifecycle);
          }else if(lifecycle.state==="cooling"){lifecycle.state="active";lifecycle.coolingStartedAt=null;lifecycle.reentries++}
        }
        if(update.transition?.from==="IN_PLAY"&&update.transition.to==="COOLING"&&lifecycle){lifecycle.state="cooling";lifecycle.coolingStartedAt=point.at}
        if(lifecycle&&lifecycle.state!=="completed"&&point.score>lifecycle.peakScore){lifecycle.peakScore=point.score;lifecycle.peakMinute=minute}
        if(update.memory.state==="IN_PLAY"){
          const peak=Math.max(peaks.get(point.symbol)??point.score,point.score);peaks.set(point.symbol,peak);
          inPlay.push({symbol:point.symbol,score:point.score,pending:update.memory.pendingTransition==="exiting",decay:Math.max(0,peak-point.score),episodeKey:lifecycle?.id??`${point.symbol}:unassigned`});
        }
      }
      inPlay.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol)); if(inPlay.length)minutesWithInPlay++;
      const compact=capAttentionDisplay(buildClusterDisplay(inPlay,ATTENTION_UNIVERSE,3),12);
      for(const row of compact.visibleRows){displayRows.push({pending:row.pending,decay:row.decay});const list=displayed.get(row.symbol)??[];list.push(minute);displayed.set(row.symbol,list);const lifecycle=lifecycles.get(row.symbol);if(lifecycle&&lifecycle.id===row.episodeKey)lifecycle.display.add(minute)}
    }
    const removals:number[]=[]; for(const lifecycle of lifecycles.values()){if(!lifecycle.display.has(lifecycle.peakMinute))continue;for(let minute=lifecycle.peakMinute+1;minute<end;minute++){if(!lifecycle.display.has(minute)){removals.push(minute-lifecycle.peakMinute);break}}}
    perSession.push({tradingDate:session.tradingDate,split:session.split,evaluatedMinutes:end-570,minutesWithInPlay,displayRows,occupancy:[...displayed.values()].flatMap(runs),peakToRemoval:removals,transitionCount,reentries:[...lifecycles.values()].map((row)=>row.reentries),episodeCount:lifecycles.size});
  }
  return (["train","holdout"] as const).map(split=>{const rows=perSession.filter(row=>row.split===split),evaluatedMinutes=rows.reduce((sum,row)=>sum+row.evaluatedMinutes,0),display=rows.flatMap(row=>row.displayRows),reentries=rows.flatMap(row=>row.reentries);return{split,evaluatedMinutes,minutesWithInPlay:rows.reduce((sum,row)=>sum+row.minutesWithInPlay,0),coverage:rows.reduce((sum,row)=>sum+row.minutesWithInPlay,0)/evaluatedMinutes,displayedSymbolMinutes:display.length,settledShare:display.length?display.filter(row=>!row.pending).length/display.length:0,pendingExitShare:display.length?display.filter(row=>row.pending).length/display.length:0,scoreDecayAtDisplay:dist(display.map(row=>row.decay)),displayedOccupancy:dist(rows.flatMap(row=>row.occupancy)),peakToRemovalMinutes:dist(rows.flatMap(row=>row.peakToRemoval)),transitionCount:rows.reduce((sum,row)=>sum+row.transitionCount,0),reentriesPerEpisode:dist(reentries),episodesWithReentry:reentries.filter(value=>value>0).length,totalEpisodes:reentries.length,perSession:rows.map(row=>({tradingDate:row.tradingDate,minutesWithInPlay:row.minutesWithInPlay,episodeCount:row.episodeCount,reentries:row.reentries.reduce((a:number,b:number)=>a+b,0)}))};});
}

function main(){
  const root=resolve("data/replay/calibration"),reports=resolve("data/replay/reports");mkdirSync(reports,{recursive:true});
  const corpus=JSON.parse(gunzipSync(readFileSync(resolve(root,"raw-features.json.gz"))).toString("utf8")) as Corpus;
  const manifest=JSON.parse(readFileSync(resolve(root,"session-manifest.json"),"utf8")) as Manifest;
  const store=JSON.parse(readFileSync(resolve(reports,"attention-thresholds.json"),"utf8")) as FeedAwareAttentionThresholdStore;
  if(corpus.splitHash!==manifest.splitHash)throw new Error("Frozen split mismatch.");
  const set=store.sets.sip.regular,base=set.values as any,points=new Map<string,Point[]>();
  for(const t of corpus.feeds.sip){const session=manifest.sessions[t[0]];if(t[3]<570||t[3]>=(session.earlyClose?780:960)||!rankable.has(corpus.symbols[t[1]]))continue;const raw:RawCalibrationPoint={tradingDate:corpus.dates[t[0]],symbol:corpus.symbols[t[1]],minuteOfDay:t[3],feedMode:"sip",subWindow:"regular",participationInput:t[4],participationInputKind:t[5]?"surprise_bits":"z",displacementZ:t[7],idiosyncrasyZ:t[8],limitedHistory:!!t[16]};const scored=scoreRawCalibrationPoint(raw,set.normalization),date=corpus.dates[t[0]],list=points.get(date)??[];list.push({date,split:session.split,minute:t[3],at:t[2],symbol:corpus.symbols[t[1]],score:scored.attention,core:scored.core});points.set(date,list)}
  const scenarios:Scenario[]=[];for(const exitCore of[.66,.67,.68,.69,.70])for(const exitPersistence of[3,5,8,10,15,20,25,30])scenarios.push({exitCore,exitPersistence});
  const results=scenarios.map(scenario=>({scenario,splits:evaluate(points,manifest.sessions,base,scenario)}));
  const usable=results.filter(row=>row.splits.every((split:any)=>split.coverage>=.10));usable.sort((a,b)=>b.splits[0].settledShare-a.splits[0].settledShare||(a.splits[0].scoreDecayAtDisplay.median??Infinity)-(b.splits[0].scoreDecayAtDisplay.median??Infinity)||b.splits[0].coverage-a.splits[0].coverage);const provisional=usable[0]??null;
  const artifact:any={schemaVersion:1,status:provisional?"provisional_pending_alert_verification":"NO_USABLE_FRONTIER_POINT",groundTruthValidation:"REFUSED",disclosure:PRE_STREAM_REPLAY_DISCLOSURE,splitHash:corpus.splitHash,coolingTimeoutMinutes:COOLING_TIMEOUT_MINUTES,usableCoverageDefinition:"at least 10% of regular-session minutes in both train and holdout; selection maximizes training settled share",results,provisionalSelection:provisional};artifact.artifactHash=sha256(stableJson(artifact));writeFileSync(resolve(reports,"exit-lifecycle-frontier.json"),JSON.stringify(artifact,null,2)+"\n");
  const pct=(v:number)=>(v*100).toFixed(2)+"%",fmt=(v:number|null)=>v===null?"n/a":v.toFixed(2),line=(row:any)=>{const [tr,ho]=row.splits;return`| ${row.scenario.exitCore.toFixed(2)} | ${row.scenario.exitPersistence} | ${pct(tr.coverage)} | ${pct(tr.settledShare)} | ${fmt(tr.scoreDecayAtDisplay.median)} | ${fmt(tr.peakToRemovalMinutes.median)} | ${pct(ho.coverage)} | ${pct(ho.settledShare)} | ${fmt(ho.scoreDecayAtDisplay.median)} | ${fmt(ho.peakToRemovalMinutes.median)} | ${tr.episodesWithReentry}/${tr.totalEpisodes} | ${ho.episodesWithReentry}/${ho.totalEpisodes} |`};
  const lines=["# Exit frontier with timed episode lifecycle","",`> ${PRE_STREAM_REPLAY_DISCLOSURE}`,"","> Population behavior only. Ground-truth validation remains refused.","","Cooling timeout: 45 minutes. IN PLAY re-entry during cooling retains the episode identity; timeout permits a new episode.","","| Exit | Persistence | Train coverage | Train settled | Train decay | Train peak→removal | Holdout coverage | Holdout settled | Holdout decay | Holdout peak→removal | Train re-entry episodes | Holdout re-entry episodes |","|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",...results.map(line),"",provisional?`Provisional selection: exit ${provisional.scenario.exitCore.toFixed(2)} / persistence ${provisional.scenario.exitPersistence}, pending alert-frequency verification.`:"No point met the explicit usable-coverage definition.","",`Artifact: \`${artifact.artifactHash}\`. Ground truth: **REFUSED**.`];writeFileSync(resolve(reports,"exit-lifecycle-frontier.md"),lines.join("\n")+"\n");console.log(JSON.stringify({artifactHash:artifact.artifactHash,status:artifact.status,provisional:provisional?.scenario??null,metrics:provisional?.splits??null},null,2));
}
main();