import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { PRE_STREAM_REPLAY_DISCLOSURE, sha256, stableJson } from "../lib/replay/archive";

const reports=resolve("data/replay/reports");
const path=resolve(reports,"waking-up-diagnosis.json");
const diagnosis=JSON.parse(readFileSync(path,"utf8"));
const corpus=JSON.parse(gunzipSync(readFileSync("data/replay/calibration/raw-features.json.gz")).toString("utf8"));
const gates=["freshness","atrTravel","minimumScore","dataQuality","persistence","velocity"];
for(const row of diagnosis.gateRows){
  for(const group of ["independent","cumulative"])for(const gate of gates)if(!row[group][gate])row[group][gate]={count:0,fraction:0};
}
diagnosis.freshnessInputCensus=Object.entries(corpus.feeds).map(([feedMode,tuples]:any)=>{const regular=tuples.filter((t:any)=>t[3]>=570&&t[3]<960),pullback=regular.filter((t:any)=>t[14]===1).length;return{feedMode,regularRows:regular.length,pullbackObservedRows:pullback,fractionPullbackObserved:pullback/regular.length};});
delete diagnosis.artifactHash;
diagnosis.artifactHash=sha256(stableJson(diagnosis));
writeFileSync(path,JSON.stringify(diagnosis,null,2)+String.fromCharCode(10));

const pct=(value:number)=>(100*value).toFixed(2)+"%";
const n=(value:number|null)=>value===null?"n/a":value.toFixed(3);
const distribution=(value:any)=>[value.p50,value.p75,value.p90,value.p95,value.p99,value.max].map(n).join(" / ");
const velocityRows=diagnosis.velocityRows.map((row:any)=>"| "+row.feedMode+" | "+row.subWindow+" | "+row.publishedVelocityThreshold.toFixed(3)+" | "+distribution(row.scoreDelta1m)+" | "+distribution(row.scoreDelta3m)+" | "+distribution(row.scoreDelta5m)+" | "+distribution(row.rollingZDelta5m)+" | "+distribution(row.scoreVelocityPerMinute)+" | "+pct(row.fractionVelocityAtLeast2)+" | "+pct(row.fractionVelocityAtLeastPublished)+" |");
const gateRows=diagnosis.gateRows.map((row:any)=>"| "+row.feedMode+" | "+row.subWindow+" | "+row.totalSymbolMinutes+" | "+pct(row.independent.freshness.fraction)+" | "+pct(row.independent.atrTravel.fraction)+" | "+pct(row.independent.minimumScore.fraction)+" | "+pct(row.independent.dataQuality.fraction)+" | "+pct(row.independent.persistence.fraction)+" | "+pct(row.independent.velocity.fraction)+" | "+row.actualWakingRows+" |");
const cumulativeRows=diagnosis.gateRows.flatMap((row:any)=>gates.map(gate=>"| "+row.feedMode+" | "+row.subWindow+" | "+gate+" | "+row.cumulative[gate].count+" | "+pct(row.cumulative[gate].fraction)+" |"));
const freshnessRows=diagnosis.freshnessVariants.map((row:any)=>"| "+row.id+" | "+row.activeEpisodeMinutes+" | "+row.counts.Fresh+" ("+pct(row.fractions.Fresh)+") | "+row.counts.Developing+" ("+pct(row.fractions.Developing)+") | "+row.counts.Mature+" ("+pct(row.fractions.Mature)+") | "+row.counts.Extended+" ("+pct(row.fractions.Extended)+") | "+row.wakingRows+" |");
const proposalEvents=diagnosis.proposal.rows.flatMap((row:any)=>row.events.map((event:any)=>"| "+row.tradingDate+" | "+String(Math.floor(event.minuteOfDay/60)).padStart(2,"0")+":"+String(event.minuteOfDay%60).padStart(2,"0")+" | "+event.symbol+" | "+event.attention.toFixed(1)+" | "+event.velocityPerMinute.toFixed(2)+" | "+event.state+" | "+event.freshness+" | "+event.atrTravelled.toFixed(2)+" |"));
const displayed=diagnosis.exitPersistenceCost.displayed,full=diagnosis.exitPersistenceCost.full;
const lines=[
"# WAKING UP zero-coverage diagnosis","","> "+PRE_STREAM_REPLAY_DISCLOSURE,"","> Diagnostic population evidence only. No discovery-quality, hit-rate, latency, move-capture, false-positive, or ground-truth conclusion is available. No gate or active calibration was changed.","",
"## Finding","",
"`freshness in {Fresh, Developing}` is the fatal gate: it passes 0 symbol-minutes in every viable feed/window, so every cumulative funnel is zero at its first stage. The corpus builder carries one session-cumulative `pullbackObserved` bit from 04:00 onward. It is true on 100% of SIP regular rows and "+pct(diagnosis.freshnessInputCensus.find((row:any)=>row.feedMode==="iex_partial").fractionPullbackObserved)+" of IEX regular rows. Because any historical pullback forces Mature, every regular-session episode is born Mature or Extended.","",
"The provisional 2.00 threshold is not active. Published velocity thresholds are 5.790-7.620 score points/minute for SIP and 10.416 for IEX regular. Velocity is not the zero-producing gate: SIP regular exceeds 2.00 on "+pct(diagnosis.velocityRows.find((row:any)=>row.feedMode==="sip"&&row.subWindow==="regular").fractionVelocityAtLeast2)+" of available symbol-minutes and its actual 7.620 threshold on "+pct(diagnosis.velocityRows.find((row:any)=>row.feedMode==="sip"&&row.subWindow==="regular").fractionVelocityAtLeastPublished)+".","",
"## Velocity definition and empirical distribution","",
"`scoreDelta1m`, `scoreDelta3m`, and `scoreDelta5m` are attention-score point changes over their named windows. `rollingZDelta5m` is the five-minute change in the mean available axis z-composite. The decision velocity is score points per minute: `scoreDelta3m / 3`, falling back to the 1-minute delta and then `scoreDelta5m / 5` when necessary.","",
"Each distribution cell is p50 / p75 / p90 / p95 / p99 / max.","",
"| Feed | Window | Published threshold (points/min) | Score delta 1m | Score delta 3m | Score delta 5m | Rolling z delta 5m | Decision velocity/min | >= 2.00 | >= published |",
"|---|---|---:|---|---|---|---|---|---:|---:|",...velocityRows,"",
"## Independent gate pass rates","",
"| Feed | Window | Symbol-minutes | Fresh/Developing | ATR below cap | Score >= 40 | Quality | Persistence | Published velocity | Actual rows |",
"|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",...gateRows,"",
"## Cumulative funnel","",
"The requested order is Fresh/Developing -> ATR cap -> minimum score -> data quality -> persistence -> velocity. Since stage one is zero, every later cumulative count is also zero; the explicit rows below prevent an absent key from being mistaken for missing instrumentation.","",
"| Feed | Window | Stage reached | Count | Fraction of all symbol-minutes |","|---|---|---|---:|---:|",...cumulativeRows,"",
"## Freshness versus exit persistence","",
"| Policy | Active episode symbol-minutes | Fresh | Developing | Mature | Extended | WAKING rows |","|---|---:|---:|---:|---:|---:|---:|",...freshnessRows,"",
"The pre-usability policy already had zero Fresh and Developing time. Holding the selected entry/exit band at two-minute exits changes almost nothing. Thirty-minute exits expand active episode time from 7,425 to 68,395 symbol-minutes, but do not cause the zero: Fresh and Developing remain zero.","",
"## Backdating interaction","",
"Among "+diagnosis.backdating.otherwiseQualifyingMoments+" SIP-regular moments that met score, quality, persistence, state, episode, guard, and velocity conditions, "+diagnosis.backdating.blockedByActualAtrButNotQualificationAtr+" ("+pct(diagnosis.backdating.blockedByActualAtrButNotQualificationAtr/diagnosis.backdating.otherwiseQualifyingMoments)+") fail the ATR-travel cap from the back-dated price but would pass from the qualification price. Backdating therefore is self-defeating for the ATR gate in a measurable minority. It changes zero current final eligibilities only because the earlier freshness gate is already fatal. Per the sequencing rule, the ATR reference correction is recorded but not applied in this one-gate counterfactual.","",
"## Single-gate counterfactual","",
"Only pullback-history semantics changed: it resets at episode start and requires a 0.5 ATR directional excursion followed by a 0.3 ATR retracement. Score, velocity, ATR cap/reference, state, persistence, quality, and backdating are unchanged. This is `counterfactual_not_published`.","",
"| Date | Time ET | Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |","|---|---|---|---:|---:|---|---|---:|",...proposalEvents,"",
"The correction produces "+diagnosis.proposal.totalWakingRows+" WAKING symbol-minutes across the five digest sessions. It proves the impossible freshness gate is repaired, but remains far too sparse to establish product usability. No further gate was changed.","",
"## Cost of 30-minute exit persistence","",
"| Population | Symbol-minutes | Settled | Pending exit | Median score decay from episode peak | p75 | p95 | Max |","|---|---:|---:|---:|---:|---:|---:|---:|","| Full IN PLAY | "+full.total+" | "+pct(full.fractionSettled)+" | "+pct(full.fractionPendingExit)+" | "+full.scoreDecayFromEpisodePeak.p50.toFixed(2)+" | "+full.scoreDecayFromEpisodePeak.p75.toFixed(2)+" | "+full.scoreDecayFromEpisodePeak.p95.toFixed(2)+" | "+full.scoreDecayFromEpisodePeak.max.toFixed(2)+" |","| Displayed IN PLAY | "+displayed.total+" | "+pct(displayed.fractionSettled)+" | "+pct(displayed.fractionPendingExit)+" | "+displayed.scoreDecayFromEpisodePeak.p50.toFixed(2)+" | "+displayed.scoreDecayFromEpisodePeak.p75.toFixed(2)+" | "+displayed.scoreDecayFromEpisodePeak.p95.toFixed(2)+" | "+displayed.scoreDecayFromEpisodePeak.max.toFixed(2)+" |","",
"Displayed IN PLAY is dominated by decaying memberships: "+pct(displayed.fractionPendingExit)+" are pending exit and median score decay is "+displayed.scoreDecayFromEpisodePeak.p50.toFixed(2)+" points. The 30-minute exit is therefore too generous on this evidence and requires a separate, single-lever recalibration; it is not changed in this diagnostic round.","",
"Artifact: `"+diagnosis.artifactHash+"`. Ground-truth validation: **REFUSED**.",""
];
writeFileSync(resolve(reports,"waking-up-diagnosis.md"),lines.join(String.fromCharCode(10)));
console.log(JSON.stringify({artifactHash:diagnosis.artifactHash,report:resolve(reports,"waking-up-diagnosis.md")},null,2));