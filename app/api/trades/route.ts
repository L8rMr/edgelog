type TradeRecord = { id:string; symbol:string; side:string; entry:string; exit:string; qty:number; entryPrice:number; exitPrice:number; pnl:number; spy:number; rrs:number; aligned:boolean; setup:string; tags:string[]; notes:string; grade:string;assetType?:"equity"|"option";contract?:string;optionType?:"call"|"put";strike?:number;expiration?:string;multiplier?:number;demo?:boolean;analysis?:unknown;analysisError?:string };

async function getD1(){try{return (await import("cloudflare:workers")).env.DB as D1Database|undefined}catch{return undefined}}
async function ensureSchema(db:D1Database){
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY, symbol TEXT NOT NULL, side TEXT NOT NULL,
      entry_time TEXT NOT NULL, exit_time TEXT NOT NULL, quantity REAL NOT NULL,
      entry_price REAL NOT NULL, exit_price REAL NOT NULL, pnl REAL NOT NULL,
      spy_move REAL NOT NULL DEFAULT 0, rrs REAL NOT NULL DEFAULT 0,
      aligned INTEGER NOT NULL DEFAULT 0, setup TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', grade TEXT NOT NULL DEFAULT '—'
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trades_exit_time ON trades(exit_time)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)"),
    db.prepare("CREATE TABLE IF NOT EXISTS trade_analysis (trade_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', error TEXT, FOREIGN KEY(trade_id) REFERENCES trades(id) ON DELETE CASCADE)")
  ]);
}

const fromRow=(r:Record<string,unknown>):TradeRecord=>({id:String(r.id),symbol:String(r.symbol),side:String(r.side),entry:String(r.entry_time),exit:String(r.exit_time),qty:Number(r.quantity),entryPrice:Number(r.entry_price),exitPrice:Number(r.exit_price),pnl:Number(r.pnl),spy:Number(r.spy_move),rrs:Number(r.rrs),aligned:Boolean(r.aligned),setup:String(r.setup),tags:JSON.parse(String(r.tags||"[]")),notes:String(r.notes),grade:String(r.grade),analysis:r.analysis_data?JSON.parse(String(r.analysis_data)):undefined,analysisError:r.analysis_error?String(r.analysis_error):undefined});
const statement=(db:D1Database,t:TradeRecord)=>db.prepare(`INSERT INTO trades (id,symbol,side,entry_time,exit_time,quantity,entry_price,exit_price,pnl,spy_move,rrs,aligned,setup,tags,notes,grade)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET symbol=excluded.symbol,side=excluded.side,entry_time=excluded.entry_time,exit_time=excluded.exit_time,quantity=excluded.quantity,entry_price=excluded.entry_price,exit_price=excluded.exit_price,pnl=excluded.pnl,spy_move=excluded.spy_move,rrs=excluded.rrs,aligned=excluded.aligned,setup=excluded.setup,tags=excluded.tags,notes=excluded.notes,grade=excluded.grade`)
  .bind(t.id,t.symbol,t.side,t.entry,t.exit,t.qty,t.entryPrice,t.exitPrice,t.pnl,t.spy,t.rrs,t.aligned?1:0,t.setup,JSON.stringify(t.tags),t.notes,t.grade);

async function readSelfHostedFile(){
  const fs=await import("node:fs/promises"),path=await import("node:path");
  const directory=process.env.EDGELOG_DATA_DIR||".edgelog-data",file=path.join(directory,"trades.json");
  try{return JSON.parse(await fs.readFile(file,"utf8")) as TradeRecord[]}catch{return []}
}
async function writeSelfHostedFile(trades:TradeRecord[]){
  const fs=await import("node:fs/promises"),path=await import("node:path");
  const directory=process.env.EDGELOG_DATA_DIR||".edgelog-data",file=path.join(directory,"trades.json"),temp=path.join(directory,"trades.tmp");
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(temp,JSON.stringify(trades,null,2),"utf8");await fs.rename(temp,file);
}

export async function GET(){const db=await getD1();if(!db)return Response.json({trades:await readSelfHostedFile()});await ensureSchema(db);const result=await db.prepare("SELECT t.*, a.data AS analysis_data, a.error AS analysis_error FROM trades t LEFT JOIN trade_analysis a ON a.trade_id=t.id ORDER BY t.exit_time DESC").all<Record<string,unknown>>();return Response.json({trades:result.results.map((r:Record<string,unknown>)=>fromRow(r))})}
export async function PUT(request:Request){const body=await request.json() as {trades?:TradeRecord[]};if(!Array.isArray(body.trades))return Response.json({error:"trades array required"},{status:400});const db=await getD1();if(!db){await writeSelfHostedFile(body.trades);return Response.json({saved:body.trades.length})}await ensureSchema(db);const analyses=body.trades.filter(t=>t.analysis||t.analysisError).map(t=>db.prepare("INSERT INTO trade_analysis (trade_id,data,error) VALUES (?,?,?)").bind(t.id,JSON.stringify(t.analysis||{}),t.analysisError||null));await db.batch([db.prepare("DELETE FROM trade_analysis"),db.prepare("DELETE FROM trades"),...body.trades.map(t=>statement(db,t)),...analyses]);return Response.json({saved:body.trades.length})}
