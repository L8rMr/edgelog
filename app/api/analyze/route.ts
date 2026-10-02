import { analyzeRdt, parseEntryTime, type RdtAnalysis } from "../../../lib/rdt";
import { createMarketLoader, sectorInfo } from "../../../lib/market-data";

type TradeInput={id:string;symbol:string;side:"Long"|"Short";entry:string;entryPrice:number;assetType?:"equity"|"option"};

export async function POST(request:Request){
  const body=await request.json() as {trades?:TradeInput[]};
  if(!Array.isArray(body.trades)||!body.trades.length)return Response.json({error:"At least one trade is required."},{status:400});
  const results:{id:string;analysis?:RdtAnalysis;error?:string}[]=[];
  for(const trade of body.trades.slice(0,100)){
    try{
      const entryMs=parseEntryTime(trade.entry);if(!Number.isFinite(entryMs))throw new Error("Entry timestamp could not be parsed");
      const market=await createMarketLoader(entryMs),sector=await sectorInfo(trade.symbol),symbols=[trade.symbol,"SPY",...(sector?[sector.etf]:[])];
      const data=await Promise.all(symbols.flatMap(symbol=>(["5minute","day"] as const).map(interval=>market.load(symbol,interval))));
      const entryBar=data[0].filter(bar=>bar.t<=entryMs).at(-1)??data[0].find(bar=>bar.t>=entryMs);
      const analysisEntryPrice=trade.assetType==="option"?entryBar?.c:trade.entryPrice;
      if(!analysisEntryPrice)throw new Error("Underlying price at option entry could not be reconstructed");
      const analysis=analyzeRdt({side:trade.side,entryPrice:analysisEntryPrice,entryMs,symbol5:data[0],symbolD:data[1],spy5:data[2],spyD:data[3],sector5:sector?data[4]:undefined,sectorD:sector?data[5]:undefined,sectorEtf:sector?.etf??null,sectorLabel:sector?.sector??null,provider:market.provider});
      results.push({id:trade.id,analysis});
    }catch(error){results.push({id:trade.id,error:error instanceof Error?error.message:"Analysis failed"})}
  }
  return Response.json({results});
}
