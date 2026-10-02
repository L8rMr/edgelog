import type { Bar } from "./rdt";

type RuntimeEnv={MASSIVE_API_KEY?:string;MARKET_DATA_PROVIDER?:string};
async function runtimeEnv():Promise<RuntimeEnv>{try{return (await import("cloudflare:workers")).env as unknown as RuntimeEnv}catch{return process.env as RuntimeEnv}}
const commonSector:Record<string,string>={AAPL:"XLK",MSFT:"XLK",NVDA:"SMH",AMD:"SMH",AVGO:"SMH",INTC:"SMH",QCOM:"SMH",CRM:"XLK",ORCL:"XLK",ADBE:"XLK",NOW:"XLK",PLTR:"XLK",META:"XLC",GOOGL:"XLC",GOOG:"XLC",NFLX:"XLC",DIS:"XLC",TMUS:"XLC",AMZN:"XLY",TSLA:"XLY",HD:"XLY",MCD:"XLY",NKE:"XLY",JPM:"XLF",BAC:"XLF",GS:"XLF",MS:"XLF",WFC:"XLF",V:"XLF",MA:"XLF",LLY:"XLV",UNH:"XLV",JNJ:"XLV",MRK:"XLV",PFE:"XLV",XOM:"XLE",CVX:"XLE",COP:"XLE",CAT:"XLI",GE:"XLI",BA:"XLI",UPS:"XLI",WMT:"XLP",COST:"XLP",KO:"XLP",PEP:"XLP",PG:"XLP"};
async function sectorMapCache():Promise<Record<string,{sector:string|null;industry:string|null;etf:string|null}>>{
  try{
    const fs=await import("node:fs/promises"),path=await import("node:path");
    const directory=process.env.EDGELOG_DATA_DIR||".edgelog-data",file=path.join(directory,"sector-map.json");
    return JSON.parse(await fs.readFile(file,"utf8"));
  }catch{return{}}
}
export async function sectorInfo(symbol:string):Promise<{etf:string;sector:string|null}|null>{
  const store=await sectorMapCache(),entry=store[symbol.toUpperCase()];
  if(entry){return entry.etf?{etf:entry.etf,sector:entry.sector}:null}
  const fallback=commonSector[symbol.toUpperCase()];
  return fallback?{etf:fallback,sector:null}:null;
}
export const sectorEtf=(symbol:string)=>commonSector[symbol.toUpperCase()]||null;
const normalize=(a:{t:number;o:number|null;h:number|null;l:number|null;c:number|null;v:number|null}[])=>a.filter(x=>[x.o,x.h,x.l,x.c].every(v=>v!==null)&&Number.isFinite(x.t)).map(x=>({t:x.t,o:x.o!,h:x.h!,l:x.l!,c:x.c!,v:x.v||0})).sort((a,b)=>a.t-b.t);
async function massive(symbol:string,interval:"5minute"|"day",from:number,to:number,key:string){const multiplier=interval==="5minute"?5:1,timespan=interval==="5minute"?"minute":"day",url=`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${multiplier}/${timespan}/${new Date(from).toISOString().slice(0,10)}/${new Date(to).toISOString().slice(0,10)}?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(key)}`,r=await fetch(url);if(!r.ok)throw new Error(`Massive returned ${r.status} for ${symbol}`);const j=await r.json() as {results?:{t:number;o:number;h:number;l:number;c:number;v:number}[];error?:string};if(!j.results?.length)throw new Error(j.error||`No ${interval} bars for ${symbol}`);return normalize(j.results)}
async function yahoo(symbol:string,interval:"5minute"|"day",from:number,to:number){const step=interval==="5minute"?"5m":"1d",url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(from/1000)}&period2=${Math.floor(to/1000)+86400}&interval=${step}&includePrePost=false&events=history`,r=await fetch(url,{headers:{"user-agent":"EdgeLog/1.0"}});if(!r.ok)throw new Error(`Yahoo chart data returned ${r.status} for ${symbol}`);const j=await r.json() as {chart:{result?:{timestamp:number[];indicators:{quote:{open:(number|null)[];high:(number|null)[];low:(number|null)[];close:(number|null)[];volume:(number|null)[]}[]}}[];error?:{description:string}}},x=j.chart.result?.[0],q=x?.indicators.quote[0];if(!x||!q)throw new Error(j.chart.error?.description||`No ${interval} bars for ${symbol}`);return normalize(x.timestamp.map((t,i)=>({t:t*1000,o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i],v:q.volume[i]})))}
async function robinhoodCache(symbol:string,interval:"5minute"|"day",from:number,to:number):Promise<Bar[]|null>{
  try{
    const fs=await import("node:fs/promises"),path=await import("node:path");
    const directory=process.env.EDGELOG_DATA_DIR||".edgelog-data",file=path.join(directory,"market-bars.json");
    const store=JSON.parse(await fs.readFile(file,"utf8")) as Record<string,{t:number;o:number;h:number;l:number;c:number;v:number}[]>;
    const bars=(store[`${symbol.toUpperCase()}:${interval}`]||[]).filter(b=>b.t>=from&&b.t<=to);
    return bars.length?normalize(bars):null;
  }catch{return null}
}
// Bar source priority per symbol/interval: bars pushed to /api/market-bars (local
// cache), then Massive when MASSIVE_API_KEY is set, then Yahoo's public chart feed.
// Requests are memoized per analysis run; 5-minute history covers 15 days before
// entry and daily history 400 days.
export async function createMarketLoader(entryMs:number){const env=await runtimeEnv(),cache=new Map<string,Promise<Bar[]>>(),sources=new Set<string>();const load=(symbol:string,interval:"5minute"|"day")=>{const key=`${symbol}:${interval}`;if(!cache.has(key)){const from=entryMs-(interval==="5minute"?15:400)*86400000,to=entryMs+86400000;cache.set(key,(async()=>{const cached=await robinhoodCache(symbol,interval,from,to);if(cached){sources.add("Robinhood");return cached}if(env.MASSIVE_API_KEY){sources.add("Massive");return massive(symbol,interval,from,to,env.MASSIVE_API_KEY)}sources.add("Yahoo chart fallback");return yahoo(symbol,interval,from,to)})())}return cache.get(key)!};return{get provider(){return sources.size?[...sources].join(" + "):(env.MARKET_DATA_PROVIDER||(env.MASSIVE_API_KEY?"Massive":"Yahoo chart fallback"))},load}}
