// RDT (r/RealDayTrading) entry-process analyzer.
//
// analyzeRdt() reconstructs market conditions at the moment of entry from 5-minute
// and daily bars for the stock, SPY and (when known) a sector ETF, then grades the
// entry on process rather than outcome. Rules, in the order they are applied:
//   1. Look-ahead protection: 5-minute bars after the entry timestamp and daily bars
//      from the entry session onward are discarded before anything is computed.
//   2. Checks: each rule (time gate, SPY alignment, relative strength, daily chart,
//      volume, void, ...) resolves to pass, fail or unverified. Missing data is
//      always "unverified", never a pass.
//   3. Gates: entry before 10:45 ET, incomplete required data, or under 1% of room
//      to the nearest daily pivot caps the displayed grade at D.
//   4. Quality score: weighted 0-100 blend of RRS vs SPY (25%), RRS vs sector (25%),
//      daily chart quality (20%), relative volume (15%) and void (15%). Components
//      with no data are dropped and the remaining weights renormalized.
// RRS = (stock move - expected move) / stock ATR, where expected move is the SPY
// move scaled by the ratio of the two ATRs (Wilder smoothing).
export type Bar={t:number;o:number;h:number;l:number;c:number;v:number};
export type Check={key:string;label:string;status:"pass"|"fail"|"unverified";value:string;evidence:string};
export type GateStatus={timeGate:boolean;dataComplete:boolean;hadRoom:boolean;failed:boolean;reasons:string[]};
export type RdtAnalysis={version:1;status:"complete"|"partial"|"failed";provider:string;analyzedAt:string;entryTimeUtc:string;direction:"Long"|"Short";relativeSignal:"RS"|"RW";sectorEtf:string|null;sectorLabel:string|null;setup:string;verdict:string;score:number|null;completeness:number;checks:Check[];metrics:{intradayRrs:number|null;intradayRrsAverage:number|null;dailyRrs:number|null;dailyRrsAverage:number|null;stockSectorRrs:number|null;sectorSpyRrs:number|null;rvol:number|null;spyMovePct:number|null;stockVwap:number|null;ema3:number|null;ema8:number|null;dailyEma8:number|null;extensionPct:number|null;voidPct:number|null;nearestLevel:number|null};unverified:string[];qualityScore:number|null;qualityGrade:string;gateStatus:GateStatus;displayGrade:string;recommendation:string};

// Automatic grades reflect verified entry-process checks, never the trade's P&L.
// A+ is deliberately reserved for a manual review that also verifies catalyst
// and discretionary chart geometry, which the bar-only analyzer cannot confirm.
export function suggestedGrade(score:number|null|undefined){
  if(score===null||score===undefined)return "—";
  if(score>=90)return "A";
  if(score>=85)return "A-";
  if(score>=80)return "B+";
  if(score>=75)return "B";
  if(score>=70)return "B-";
  if(score>=60)return "C+";
  if(score>=50)return "C";
  return "D";
}

const etParts=(ms:number)=>Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(ms).filter(x=>x.type!=="literal").map(x=>[x.type,Number(x.value)])) as Record<string,number>;
const sessionKey=(ms:number)=>{const p=etParts(ms);return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`};
export function parseEntryTime(value:string){if(/[zZ]|[+-]\d\d:?\d\d$/.test(value))return new Date(value).getTime();const m=value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);if(!m)return new Date(value).getTime();const target=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0));let guess=target+5*3600000;for(let i=0;i<2;i++){const p=etParts(guess),shown=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);guess+=target-shown}return guess}
const tr=(bars:Bar[])=>bars.map((b,i)=>i?Math.max(b.h,bars[i-1].c)-Math.min(b.l,bars[i-1].c):null);
export function wilderAtr(bars:Bar[],length:number){const raw=tr(bars),lag:(number|null)[]=[null,...raw.slice(0,-1)],out:(number|null)[]=Array(bars.length).fill(null),seed:number[]=[];let start=-1;for(let i=0;i<lag.length;i++){if(lag[i]!==null)seed.push(lag[i] as number);if(seed.length===length){start=i;break}}if(start<0)return out;out[start]=seed.reduce((a,b)=>a+b,0)/length;for(let i=start+1;i<bars.length;i++)out[i]=lag[i]===null?out[i-1]:((out[i-1] as number)*(length-1)+(lag[i] as number))/length;return out}
export function ema(values:number[],period:number){const out:(number|null)[]=Array(values.length).fill(null);if(values.length<period)return out;out[period-1]=values.slice(0,period).reduce((a,b)=>a+b,0)/period;const k=2/(period+1);for(let i=period;i<values.length;i++)out[i]=values[i]*k+(out[i-1] as number)*(1-k);return out}
export function rrsSeries(symbol:Bar[],benchmark:Bar[],length:number){const cmp=new Map(benchmark.map(b=>[b.t,b])),pairs=symbol.filter(b=>cmp.has(b.t)).map(b=>[b,cmp.get(b.t)!] as const),s=pairs.map(x=>x[0]),c=pairs.map(x=>x[1]),sa=wilderAtr(s,length),ca=wilderAtr(c,length);return pairs.map((x,i)=>{if(i<length||!sa[i]||!ca[i])return null;const cmpMove=c[i].c-c[i-length].c,symMove=s[i].c-s[i-length].c,power=cmpMove/(ca[i] as number),expected=power*(sa[i] as number);return{t:s[i].t,rrs:(symMove-expected)/(sa[i] as number)}}).filter((x):x is {t:number;rrs:number}=>x!==null)}
const latestRrs=(a:Bar[],b:Bar[],length:number)=>{const s=rrsSeries(a,b,length),tail=s.slice(-Math.min(length,6)),latest=s.at(-1)?.rrs??null,average=tail.length?tail.reduce((n,x)=>n+x.rrs,0)/tail.length:null;return{latest,average,values:tail.map(x=>x.rrs)}};
const vwap=(bars:Bar[])=>{const d=bars.reduce((a,b)=>({pv:a.pv+((b.h+b.l+b.c)/3)*b.v,v:a.v+b.v}),{pv:0,v:0});return d.v?d.pv/d.v:null};
export function timeRvol(bars:Bar[],entryMs:number){const current=sessionKey(entryMs),p=etParts(entryMs),minute=p.hour*60+p.minute,groups=new Map<string,Bar[]>();bars.forEach(b=>{const k=sessionKey(b.t),a=groups.get(k)||[];a.push(b);groups.set(k,a)});const cumulative=(a:Bar[])=>a.filter(b=>{const x=etParts(b.t);return x.hour*60+x.minute<=minute}).reduce((n,b)=>n+b.v,0),today=cumulative(groups.get(current)||[]),prior=Array.from(groups).filter(([k])=>k<current).slice(-10).map(([,a])=>cumulative(a)).filter(Boolean);if(!today||prior.length<2)return null;return today/(prior.reduce((a,b)=>a+b,0)/prior.length)}
const pivots=(bars:Bar[])=>bars.map((b,i)=>i<2||i>=bars.length-2?null:{high:b.h===Math.max(...bars.slice(i-2,i+3).map(x=>x.h))?b.h:null,low:b.l===Math.min(...bars.slice(i-2,i+3).map(x=>x.l))?b.l:null}).filter(Boolean) as {high:number|null;low:number|null}[];
const voidMetric=(daily:Bar[],price:number,side:"Long"|"Short")=>{const ps=pivots(daily),levels=side==="Long"?ps.map(x=>x.high).filter((x):x is number=>!!x&&x>price).sort((a,b)=>a-b):ps.map(x=>x.low).filter((x):x is number=>!!x&&x<price).sort((a,b)=>b-a),level=levels[0]??null,pct=level===null?null:Math.abs(level-price)/price*100;return{level,pct}};
const efficiency=(bars:Bar[])=>{if(bars.length<2)return 0;const net=Math.abs(bars.at(-1)!.c-bars[0].c),travel=bars.slice(1).reduce((n,b,i)=>n+Math.abs(b.c-bars[i].c),0);return travel?net/travel:0};
const persistent=(values:number[],side:"Long"|"Short")=>values.length>=3&&values.slice(-3).every(x=>side==="Long"?x>.5:x<-.5);
const check=(key:string,label:string,status:Check["status"],value:string,evidence:string):Check=>({key,label,status,value,evidence});

// Quality-score sub-metric normalization. RRS is ATR-normalized and centers on 0;
// treat 0 as neutral (50) and +-2 ATR as saturating (0/100). RVOL and void% are
// scaled against a ceiling well above their pass thresholds (1.2x, 1%) so a
// merely-passing trade doesn't already max out that component.
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
const rrsToScore=(rrs:number|null,side:"Long"|"Short")=>rrs===null?null:Math.round(clamp(((side==="Long"?rrs:-rrs)+2)/4*100,0,100));
const rvolToScore=(rvol:number|null)=>rvol===null?null:Math.round(clamp(rvol/2.5*100,0,100));
const voidToScore=(pct:number|null)=>pct===null?null:Math.round(clamp(pct/5*100,0,100));
const dailyToScore=(eff:number,slopeOk:boolean,extensionPct:number|null)=>{const penalty=extensionPct===null?.5:clamp(Math.abs(extensionPct)/10,0,1),base=clamp(eff,0,1)*100*(1-penalty*.5);return Math.round(slopeOk?base:base*.5)};
function qualityScoreOf(parts:{weight:number;value:number|null}[]):number|null{const w=parts.filter(p=>p.value!==null).reduce((a,p)=>a+p.weight,0);return w>0?Math.round(parts.reduce((a,p)=>a+(p.value!==null?p.value*p.weight:0),0)/w):null}

// One sentence per triggering condition, most severe/fixable first. Gate
// failures dominate (they cap the grade at D regardless of quality score),
// so quality sub-score commentary is only shown when every gate passed —
// otherwise it's noise competing with the thing that actually capped the grade.
function buildRecommendation(a:{side:"Long"|"Short";direction:number;timeGate:boolean;hadRoom:boolean;dataComplete:boolean;gateFailed:boolean;et:{hour:number;minute:number};voids:{level:number|null;pct:number|null};checks:Check[];ir:{latest:number|null};stockSector:{latest:number|null}|null;rvol:number|null;last20:Bar[];dailyQuality:boolean;dailySlope:number;extension:number|null;spyTrend:number;aligned:boolean;qualityScore:number|null;qualityGrade:string}):string{
  const {side,direction,timeGate,hadRoom,dataComplete,gateFailed,et,voids,checks,ir,stockSector,rvol,last20,dailyQuality,dailySlope,extension,spyTrend,aligned,qualityScore,qualityGrade}=a;
  const signed=(v:number|null)=>v===null?null:(side==="Long"?v:-v);
  if(gateFailed){
    const reasons:string[]=[];
    if(!timeGate){const minutesBefore=645-(et.hour*60+et.minute);reasons.push(`entered ${minutesBefore} min before 10:45 ET — the same setup after the gate would have passed this check`)}
    if(!hadRoom){reasons.push(voids.level===null?"no qualifying structural level was found above entry to measure void against — wait for a level with real room, or use a trailing-stop plan instead of a fixed target":`only ${voids.pct!.toFixed(2)}% of room to the nearest level (${voids.level!.toFixed(2)}) — wait for a level with real void, or use a trailing-stop plan instead of a fixed target`)}
    if(!dataComplete){const missing=checks.filter(c=>!["catalyst","geometry","sector"].includes(c.key)&&c.status==="unverified").map(c=>c.label);reasons.push(missing.length?`missing ${missing.join(", ")} — recommendation confidence is reduced until this is available`:"required bar data was incomplete — recommendation confidence is reduced until this is available")}
    const header=`Gate failed on ${reasons.length} count${reasons.length===1?"":"s"}: ${reasons.join("; ")}. This caps the grade at D regardless of quality score.`;
    const closer=qualityScore===null?"":` Quality score if gates had passed: ${qualityGrade} (${qualityScore}).`;
    return header+closer;
  }
  const lines:string[]=[];
  const signedRs=signed(ir.latest);
  if(signedRs!==null&&signedRs<2)lines.push(`RS vs SPY was only ${ir.latest!.toFixed(1)} — look for persistent 5-day outperformance, not a single strong bar.`);
  const signedSector=signed(stockSector?.latest??null);
  if(signedSector!==null){
    const beatingSpy=signedRs!==null&&signedRs>=2;
    if(signedSector<2)lines.push(beatingSpy?`Beating SPY but lagging its own sector (${stockSector!.latest!.toFixed(1)} vs sector) — this was riding beta, not leading. Screen for names beating both.`:`RS vs sector was only ${stockSector!.latest!.toFixed(1)} — this name wasn't leading its own group either.`)
  }
  if(!dailyQuality&&last20.length>=15){
    const eff=efficiency(last20);
    if(Math.sign(dailySlope)!==direction)lines.push(`Daily trend direction didn't match the trade (${dailySlope>=0?"+":""}${dailySlope.toFixed(1)}% over 20 sessions) — wait for the daily chart to actually agree with the trade direction.`);
    else if(eff<.28)lines.push(`Daily chart was choppy — only ${(eff*100).toFixed(0)}% efficient (net move vs total travel) — wait for a cleaner base.`);
    else if(extension!==null&&Math.abs(extension)>=10)lines.push(`Entry was ${extension>=0?"+":""}${extension.toFixed(1)}% extended from the 8 EMA — wait for a pullback closer to the average.`);
  }
  if(rvol!==null&&rvol<1.5)lines.push(`Relative volume was only ${rvol.toFixed(2)}× — no strong participation confirming the move.`);
  if(spyTrend!==0&&!aligned)lines.push(`SPY was moving ${spyTrend>0?"bullish":"bearish"} against the trade direction — this needs exceptional documented RS/RW to justify going against the tape, or wait for SPY alignment.`);
  const scoreLine=qualityScore===null?"":`Quality score: ${qualityGrade} (${qualityScore}).`;
  return lines.length?[...lines,scoreLine].filter(Boolean).join(" "):`${scoreLine} All computed criteria were within target range.`.trim();
}

export function analyzeRdt(input:{side:"Long"|"Short";entryPrice:number;entryMs:number;symbol5:Bar[];spy5:Bar[];symbolD:Bar[];spyD:Bar[];sector5?:Bar[];sectorD?:Bar[];sectorEtf?:string|null;sectorLabel?:string|null;provider:string}):RdtAnalysis{
  const {side,entryPrice,entryMs}=input,direction=side==="Long"?1:-1,relativeSignal=side==="Long"?"RS":"RW",entrySession=sessionKey(entryMs),regular=(b:Bar)=>{const p=etParts(b.t),m=p.hour*60+p.minute;return m>=570&&m<960},cut5=(a:Bar[])=>a.filter(b=>b.t<=entryMs&&regular(b)),cutDaily=(a:Bar[])=>a.filter(b=>sessionKey(b.t)<entrySession),s5=cut5(input.symbol5),spy5=cut5(input.spy5),sd=cutDaily(input.symbolD),spyd=cutDaily(input.spyD),sec5=cut5(input.sector5||[]),secd=cutDaily(input.sectorD||[]),session=s5.filter(b=>sessionKey(b.t)===entrySession),spySession=spy5.filter(b=>sessionKey(b.t)===entrySession);
  const ir=latestRrs(s5,spy5,12),dr=latestRrs(sd,spyd,5),stockSector=secd.length?latestRrs(sd,secd,5):null,sectorSpy=secd.length?latestRrs(secd,spyd,5):null,rvol=timeRvol(s5,entryMs),stockVwap=vwap(session),e3=ema(s5.map(b=>b.c),3).at(-1)??null,e8=ema(s5.map(b=>b.c),8).at(-1)??null,de8=ema(sd.map(b=>b.c),8).at(-1)??null,extension=de8?(entryPrice-de8)/de8*100:null,voids=voidMetric(sd.slice(-120),entryPrice,side),et=etParts(entryMs),afterGate=et.hour*60+et.minute>=645,spyMove=spySession.length?(spySession.at(-1)!.c-spySession[0].o)/spySession[0].o*100:null,spyVwap=vwap(spySession),spyPrice=spySession.at(-1)?.c??null,spyE3=ema(spy5.map(b=>b.c),3).at(-1)??null,spyE8=ema(spy5.map(b=>b.c),8).at(-1)??null,spyVwapDirection=spyVwap&&spyPrice?Math.sign(spyPrice-spyVwap):0,spyEmaDirection=spyE3!==null&&spyE8!==null?Math.sign(spyE3-spyE8):0,spyMoveDirection=spyMove!==null&&Math.abs(spyMove)>=.05?Math.sign(spyMove):0,spyStructured=spyVwapDirection!==0&&spyVwapDirection===spyEmaDirection&&(spyMoveDirection===0||spyMoveDirection===spyVwapDirection),spyTrend=spyStructured?spyVwapDirection:spyMove!==null&&Math.abs(spyMove)>=.15&&spyVwapDirection===Math.sign(spyMove)?Math.sign(spyMove):0,aligned=spyTrend!==0&&spyTrend===direction;
  const last20=sd.slice(-20),dailySlope=last20.length>1?(last20.at(-1)!.c-last20[0].c)/last20[0].c*100:0,dailyQuality=last20.length>=15&&efficiency(last20)>=.28&&Math.sign(dailySlope)===direction&&extension!==null&&Math.abs(extension)<10,emaOk=e3!==null&&e8!==null&&direction*(e3-e8)>0,vwapOk=stockVwap!==null&&direction*(entryPrice-stockVwap)>0,rrsOk=persistent(ir.values,side),dailyRrsOk=persistent(dr.values,side),stacked=stockSector&&sectorSpy?persistent(stockSector.values,side)&&persistent(sectorSpy.values,side):null;
  const checks:Check[]=[check("time","Time gate",afterGate?"pass":"fail",`${String(et.hour).padStart(2,"0")}:${String(et.minute).padStart(2,"0")} ET`,afterGate?"Entry occurred after 10:45 ET.":"Entry occurred before market direction had enough time to develop."),check("market","SPY alignment",spyTrend===0?"fail":aligned?"pass":"fail",spyMove===null?"n/a":`${spyMove>=0?"+":""}${spyMove.toFixed(2)}% · ${spyTrend>0?"bullish":spyTrend<0?"bearish":"neutral"}`,spyTrend===0?"SPY direction was not confirmed by its move, VWAP, and 3/8 EMA structure.":aligned?`Trade direction agreed with SPY's ${spyTrend>0?"bullish":"bearish"} trend at entry.`:"Trade direction opposed SPY at entry."),check("daily","Daily chart quality",last20.length<15?"unverified":dailyQuality?"pass":"fail",extension===null?"n/a":`${extension>=0?"+":""}${extension.toFixed(1)}% from 8 EMA`,dailyQuality?"Daily trend was legible, efficient, and not overextended.":"Daily trend, efficiency, direction, or extension failed."),check("daily_rrs",`Daily ${relativeSignal} vs SPY`,dr.latest===null?"unverified":dailyRrsOk?"pass":"fail",dr.latest===null?"n/a":dr.latest.toFixed(2),dailyRrsOk?`The last three daily ${relativeSignal} readings were persistent for the ${side.toLowerCase()}.`:`Daily ${relativeSignal} was absent or not persistent for the ${side.toLowerCase()}.`),check("sector","Stacked sector",stacked===null?"unverified":stacked?"pass":"fail",stockSector?.latest!=null?`${input.sectorEtf} · RS ${stockSector.latest.toFixed(2)}`:input.sectorEtf||"n/a",stacked===null?"No verified sector ETF mapping was available.":stacked?"Stock and sector relative performance confirmed in the trade direction.":"The stock/sector/SPY stack did not confirm."),check("rvol","Relative volume",rvol===null?"unverified":rvol>=1.2?"pass":"fail",rvol===null?"n/a":`${rvol.toFixed(2)}×`,rvol===null?"Not enough matching prior sessions at this time of day.":rvol>=1.2?"Cumulative volume cleared the 1.2× floor.":"Volume was below the 1.2× floor."),check("void","Void to target",voids.pct===null?"unverified":voids.pct>=1?"pass":"fail",voids.pct===null?"n/a":`${voids.pct.toFixed(2)}%`,voids.level===null?"No qualifying pivot level was found in the supplied history.":`Nearest structure level was ${voids.level.toFixed(2)}.`),check("intraday_rrs",`Intraday ${relativeSignal} vs SPY`,ir.latest===null?"unverified":rrsOk?"pass":"fail",ir.latest===null?"n/a":ir.latest.toFixed(2),rrsOk?`${relativeSignal} held through the last three readings in the trade direction.`:`${relativeSignal} was insufficient or not persistent for the ${side.toLowerCase()}.`),check("ema","3/8 EMA timing",e3===null||e8===null?"unverified":emaOk?"pass":"fail",e3===null||e8===null?"n/a":`${e3.toFixed(2)} / ${e8.toFixed(2)}`,emaOk?"Fast EMA confirmed the trade direction.":"Fast EMA did not confirm the entry."),check("vwap","VWAP timing",stockVwap===null?"unverified":vwapOk?"pass":"fail",stockVwap===null?"n/a":stockVwap.toFixed(2),vwapOk?"Entry was on the correct side of VWAP.":"Entry was on the wrong side of VWAP."),check("catalyst","News catalyst","unverified","n/a","The historical bar provider does not verify timestamped company news or filings."),check("geometry","Algo / diagonal lines","unverified","n/a","OHLCV geometry can generate candidates, but discretionary anchor and volume validation is not automated here.")];
  const verified=checks.filter(c=>c.status!=="unverified"),passes=verified.filter(c=>c.status==="pass").length,score=verified.length>=5?Math.round(passes/verified.length*100):null,unverified=checks.filter(c=>c.status==="unverified").map(c=>c.label),breakout=sd.length>22&&(side==="Long"?entryPrice>Math.max(...sd.slice(-22,-2).map(b=>b.h)):entryPrice<Math.min(...sd.slice(-22,-2).map(b=>b.l))),bestFit=dailyQuality?`D1 ${side==="Long"?"trend":"weakness"} continuation attempt`:dailyRrsOk?`Daily relative ${side==="Long"?"strength":"weakness"} continuation attempt`:vwapOk&&emaOk?`${side} VWAP continuation attempt`:rvol!==null&&rvol>=1.2?`${side} high-volume momentum attempt`:`${side} momentum attempt`,setup=breakout?`D1 ${side==="Long"?"breakout":"breakdown"}`:vwapOk&&rrsOk?`${side==="Long"?"RS":"RW"} VWAP continuation`:rrsOk?`Persistent ${side==="Long"?"relative strength":"relative weakness"}`:`${bestFit} — did not meet RDT criteria`,failed=checks.filter(c=>c.status==="fail"),verdict=failed.length?`Process failed: ${failed.slice(0,2).map(c=>c.label).join(" and ")}.`:"Verified RDT criteria passed at entry.";
  const d1Score=last20.length<15?null:dailyToScore(efficiency(last20),Math.sign(dailySlope)===direction,extension),
    qualityScore=qualityScoreOf([{weight:.25,value:rrsToScore(ir.latest,side)},{weight:.25,value:rrsToScore(stockSector?.latest??null,side)},{weight:.20,value:d1Score},{weight:.15,value:rvolToScore(rvol)},{weight:.15,value:voidToScore(voids.pct)}]),
    timeGate=afterGate,
    dataComplete=checks.filter(c=>!["catalyst","geometry","sector"].includes(c.key)).every(c=>c.status!=="unverified"),
    hadRoom=voids.pct!==null&&voids.pct>=1,
    gateFailed=!timeGate||!dataComplete||!hadRoom,
    gateReasons=[!timeGate&&"time gate",!dataComplete&&"incomplete data",!hadRoom&&"no room to target"].filter((x):x is string=>!!x),
    qualityGrade=suggestedGrade(qualityScore),
    displayGrade=gateFailed?"D":qualityGrade,
    recommendation=buildRecommendation({side,direction,timeGate,hadRoom,dataComplete,gateFailed,et,voids,checks,ir,stockSector,rvol,last20,dailyQuality,dailySlope,extension,spyTrend,aligned,qualityScore,qualityGrade});
  return{version:1,status:unverified.length?"partial":"complete",provider:input.provider,analyzedAt:new Date().toISOString(),entryTimeUtc:new Date(entryMs).toISOString(),direction:side,relativeSignal,sectorEtf:input.sectorEtf||null,sectorLabel:input.sectorLabel||null,setup,verdict,score,completeness:Math.round(verified.length/checks.length*100),checks,metrics:{intradayRrs:ir.latest,intradayRrsAverage:ir.average,dailyRrs:dr.latest,dailyRrsAverage:dr.average,stockSectorRrs:stockSector?.latest??null,sectorSpyRrs:sectorSpy?.latest??null,rvol,spyMovePct:spyMove,stockVwap,ema3:e3,ema8:e8,dailyEma8:de8,extensionPct:extension,voidPct:voids.pct,nearestLevel:voids.level},unverified,qualityScore,qualityGrade,gateStatus:{timeGate,dataComplete,hadRoom,failed:gateFailed,reasons:gateReasons},displayGrade,recommendation};
}
