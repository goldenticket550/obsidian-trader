import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { updateAttentionState, type AttentionStateMemory } from "../lib/attention/attentionState";
import type { AttentionNormalizationCurves } from "../lib/attention/attentionAxes";
import { PRE_STREAM_REPLAY_DISCLOSURE, sha256, stableJson } from "../lib/replay/archive";
import { quantile, scoreRawCalibrationPoint, type RawCalibrationPoint } from "../lib/replay/populationCalibration";
import type { ResolvedAttentionThresholdValues } from "../lib/replay/attentionThresholdTypes";

type Tuple = [number, number, number, number, number, 0|1, 0|1|2, number, number, number, number, number|null, number|null, number, 0|1, 0|1, 0|1];
interface Corpus { splitHash:string; dates:string[]; symbols:string[]; feeds:{sip:Tuple[];iex_partial:Tuple[]}; }
interface Session { tradingDate:string; split:"train"|"holdout"; earlyClose:boolean; }
interface Manifest { splitHash:string; sessions:Session[]; }
interface CandidateRow { candidate:string; subWindow:string; curves:AttentionNormalizationCurves; values:Omit<ResolvedAttentionThresholdValues,"enterPersistenceMinutes"|"exitPersistenceMinutes">; }
interface Scenario { id:string; kind:"control"|"exit_persistence_only"|"exit_threshold_only"|"combined_exit"|"enter_threshold_only"|"enter_plus_exit"; inPlayEnterCore:number; inPlayExitCore:number; exitPersistenceMinutes:number; }
interface SplitMetrics {
  split:"train"|"holdout";
  evaluatedMinutes:number;
  minutesWithInPlay:number;
  fractionMinutesWithInPlay:number;
  inPlayOccupancy:{count:number;min:number|null;p25:number|null;median:number|null;p75:number|null;max:number|null;iqr:number|null};
  gapsBetweenPeriods:{count:number;min:number|null;p25:number|null;median:number|null;p75:number|null;max:number|null;iqr:number|null};
  quietSessions:string[];
  perSession:Array<{tradingDate:string;evaluatedMinutes:number;minutesWithInPlay:number;fractionMinutesWithInPlay:number;occupancies:number[];gaps:number[]}>;
}
const regularStart=570, regularEnd=(session:Session)=>session.earlyClose?780:960;
function dist(values:number[]) { if(!values.length) return {count:0,min:null,p25:null,median:null,p75:null,max:null,iqr:null}; const p25=quantile(values,.25),p75=quantile(values,.75); return {count:values.length,min:Math.min(...values),p25,median:quantile(values,.5),p75,max:Math.max(...values),iqr:p75-p25}; }
function raw(t:Tuple,c:Corpus):RawCalibrationPoint { return {tradingDate:c.dates[t[0]],symbol:c.symbols[t[1]],minuteOfDay:t[3],feedMode:"sip",subWindow:"regular",participationInput:t[4],participationInputKind:t[5]===0?"z":"surprise_bits",displacementZ:t[7],idiosyncrasyZ:t[8],limitedHistory:t[16]===1}; }
function evaluate(c:Corpus,m:Manifest,curves:AttentionNormalizationCurves,base:ResolvedAttentionThresholdValues,scenario:Scenario):SplitMetrics[] {
  const thresholds={...base,inPlayEnterCore:scenario.inPlayEnterCore,inPlayExitCore:scenario.inPlayExitCore,exitPersistenceMinutes:scenario.exitPersistenceMinutes};
  const bySession=Array.from({length:m.sessions.length},()=>[] as Tuple[]);
  for(const t of c.feeds.sip) if(t[3]>=regularStart&&t[3]<regularEnd(m.sessions[t[0]])) bySession[t[0]].push(t);
  const rows:SplitMetrics["perSession"]=[];
  for(let index=0;index<m.sessions.length;index++){
    const session=m.sessions[index], memories=new Map<string,AttentionStateMemory>(), byMinute=new Map<number,Tuple[]>();
    for(const t of bySession[index]) { const list=byMinute.get(t[3])??[]; list.push(t); byMinute.set(t[3],list); }
    const activeMinutes:number[]=[], activeBySymbol=new Map<string,number[]>();
    for(let minute=regularStart;minute<regularEnd(session);minute++){
      let any=false;
      for(const t of byMinute.get(minute)??[]){
        const point=raw(t,c), scored=scoreRawCalibrationPoint(point,curves), prior=memories.get(point.symbol)??null;
        const next=updateAttentionState({previous:prior,at:t[2],core:scored.core,thresholds,enterPersistenceMinutes:base.enterPersistenceMinutes,exitPersistenceMinutes:scenario.exitPersistenceMinutes}).memory;
        memories.set(point.symbol,next);
        if(next.state==="IN_PLAY") { any=true; const list=activeBySymbol.get(point.symbol)??[]; list.push(minute); activeBySymbol.set(point.symbol,list); }
      }
      if(any) activeMinutes.push(minute);
    }
    const occupancies=[...activeBySymbol.values()].flatMap(series=>{const out:number[]=[];let run=1;for(let i=1;i<series.length;i++){if(series[i]===series[i-1]+1)run++;else{out.push(run);run=1;}}if(series.length)out.push(run);return out;});
    const gaps:number[]=[];for(let i=1;i<activeMinutes.length;i++){const gap=activeMinutes[i]-activeMinutes[i-1]-1;if(gap>0)gaps.push(gap);}
    const evaluatedMinutes=regularEnd(session)-regularStart;
    rows.push({tradingDate:session.tradingDate,evaluatedMinutes,minutesWithInPlay:activeMinutes.length,fractionMinutesWithInPlay:activeMinutes.length/evaluatedMinutes,occupancies,gaps});
  }
  return (["train","holdout"] as const).map(split=>{const group=rows.filter(row=>m.sessions.find(s=>s.tradingDate===row.tradingDate)!.split===split),evaluatedMinutes=group.reduce((s,r)=>s+r.evaluatedMinutes,0),minutesWithInPlay=group.reduce((s,r)=>s+r.minutesWithInPlay,0);return {split,evaluatedMinutes,minutesWithInPlay,fractionMinutesWithInPlay:minutesWithInPlay/evaluatedMinutes,inPlayOccupancy:dist(group.flatMap(r=>r.occupancies)),gapsBetweenPeriods:dist(group.flatMap(r=>r.gaps)),quietSessions:group.filter(r=>r.minutesWithInPlay===0).map(r=>r.tradingDate),perSession:group};});
}
function main(){
  const root=resolve("data/replay/calibration"), reports=resolve("data/replay/reports");mkdirSync(reports,{recursive:true});
  const c=JSON.parse(gunzipSync(readFileSync(resolve(root,"raw-features.json.gz"))).toString("utf8")) as Corpus,m=JSON.parse(readFileSync(resolve(root,"session-manifest.json"),"utf8")) as Manifest;
  if(c.splitHash!==m.splitHash)throw new Error("Frozen split mismatch.");
  const candidate=JSON.parse(readFileSync(resolve(reports,"attention-saturation-candidate-replay.json"),"utf8")) as {fitRows:CandidateRow[]};
  const regular=candidate.fitRows.find(row=>row.candidate==="log_participation_range_theoretical_max_rescale"&&row.subWindow==="regular");if(!regular)throw new Error("Accepted combined regular fit missing.");
  const base:ResolvedAttentionThresholdValues={...regular.values,enterPersistenceMinutes:2,exitPersistenceMinutes:2};
  const exitLevels=[.74,.70,.65,.60,.55,.50,.45], enterLevels=[.79,.80,.81,.82,.84,.86,.90,.94,.97];
  const scenarios:Scenario[]=[{id:"control",kind:"control",inPlayEnterCore:base.inPlayEnterCore,inPlayExitCore:base.inPlayExitCore,exitPersistenceMinutes:2},...([3,5,10,15].map(exitPersistenceMinutes=>({id:`persistence-${exitPersistenceMinutes}`,kind:"exit_persistence_only" as const,inPlayEnterCore:base.inPlayEnterCore,inPlayExitCore:base.inPlayExitCore,exitPersistenceMinutes}))),...(exitLevels.map(inPlayExitCore=>({id:`exit-${inPlayExitCore.toFixed(2)}`,kind:"exit_threshold_only" as const,inPlayEnterCore:base.inPlayEnterCore,inPlayExitCore,exitPersistenceMinutes:2}))),...(exitLevels.flatMap(inPlayExitCore=>[3,5,10,15].map(exitPersistenceMinutes=>({id:`exit-${inPlayExitCore.toFixed(2)}-p${exitPersistenceMinutes}`,kind:"combined_exit" as const,inPlayEnterCore:base.inPlayEnterCore,inPlayExitCore,exitPersistenceMinutes})))),...(enterLevels.map(inPlayEnterCore=>({id:`enter-${inPlayEnterCore.toFixed(2)}`,kind:"enter_threshold_only" as const,inPlayEnterCore,inPlayExitCore:base.inPlayExitCore,exitPersistenceMinutes:2}))),...(enterLevels.flatMap(inPlayEnterCore=>[.74,.70,.66,.50,.45].flatMap(inPlayExitCore=>(inPlayExitCore >= base.emergingExitCore ? [15,20,25,30] : [15,20]).map(exitPersistenceMinutes=>({id:`enter-${inPlayEnterCore.toFixed(2)}-exit-${inPlayExitCore.toFixed(2)}-p${exitPersistenceMinutes}`,kind:"enter_plus_exit" as const,inPlayEnterCore,inPlayExitCore,exitPersistenceMinutes})))) )];
  const results=scenarios.map(scenario=>({scenario,splits:evaluate(c,m,regular.curves,base,scenario)}));
  const eligible=results.filter(row=>{const train=row.splits.find(s=>s.split==="train")!;return train.fractionMinutesWithInPlay>=.20&&train.fractionMinutesWithInPlay<=.40&&(train.inPlayOccupancy.median??0)>=10&&["2026-02-13","2026-04-20","2026-05-06"].every(date=>row.splits.some(s=>s.quietSessions.includes(date)));});
  eligible.sort((a,b)=>a.scenario.inPlayEnterCore-b.scenario.inPlayEnterCore||b.scenario.inPlayExitCore-a.scenario.inPlayExitCore||a.scenario.exitPersistenceMinutes-b.scenario.exitPersistenceMinutes);
  const selected=eligible[0]??null;
  const artifact={schemaVersion:1,scope:"exit_lever_population_calibration",groundTruthValidation:"REFUSED",disclosure:PRE_STREAM_REPLAY_DISCLOSURE,splitHash:c.splitHash,rawFeaturesSha256:sha256(readFileSync(resolve(root,"raw-features.json.gz"))),acceptedMeasurement:"log1p participation + log1p range + theoretical-max rescale",enterThresholdsFrozen:true,baseCurves:regular.curves,baseValues:base,targets:{trainingFractionMinutesWithInPlay:[.20,.40],trainingMedianInPlayOccupancyMinutes:10,preserveQuietSessions:["2026-02-13","2026-04-20","2026-05-06"]},results,selectedScenario:selected?.scenario??null};
  const artifactHash=sha256(stableJson(artifact));writeFileSync(resolve(reports,"attention-usability-exit-sweep.json"),`${JSON.stringify({...artifact,artifactHash},null,2)}\n`);
  const lines=["# Attention usability — exit-lever sweep","",`> ${PRE_STREAM_REPLAY_DISCLOSURE}`,"","> Population behavior only. Ground-truth validation is refused. Enter thresholds and curves were frozen; this experiment changes only IN PLAY exit threshold and/or exit persistence.","","| Scenario | Lever | Enter core | Exit core | Exit persistence | Train coverage | Train dwell median/IQR | Holdout coverage | Holdout dwell median/IQR | Quiet sessions preserved |","|---|---|---:|---:|---:|---:|---:|---:|---:|---|",...results.map(row=>{const tr=row.splits[0],ho=row.splits[1];return `| ${row.scenario.id} | ${row.scenario.kind} | ${row.scenario.inPlayEnterCore.toFixed(4)} | ${row.scenario.inPlayExitCore.toFixed(4)} | ${row.scenario.exitPersistenceMinutes} | ${(100*tr.fractionMinutesWithInPlay).toFixed(2)}% | ${tr.inPlayOccupancy.median ?? "n/a"} / ${tr.inPlayOccupancy.p25 ?? "n/a"}–${tr.inPlayOccupancy.p75 ?? "n/a"} | ${(100*ho.fractionMinutesWithInPlay).toFixed(2)}% | ${ho.inPlayOccupancy.median ?? "n/a"} / ${ho.inPlayOccupancy.p25 ?? "n/a"}–${ho.inPlayOccupancy.p75 ?? "n/a"} | ${[...tr.quietSessions,...ho.quietSessions].filter(d=>["2026-02-13","2026-04-20","2026-05-06"].includes(d)).length===3?"yes":"NO"} |`;}) ,"",selected?`Selected from training only: ${selected.scenario.id}. Holdout was inspected only after selection.`:"No exit-only scenario met both usability targets; enter-threshold changes remain untested and unpublished.",""];writeFileSync(resolve(reports,"attention-usability-exit-sweep.md"),lines.join("\n"));console.log(JSON.stringify({artifactHash,selected:selected?.scenario??null,eligible:eligible.length},null,2));
}
main();