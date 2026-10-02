type TradeRecord = { id:string; symbol:string; side:string; entry:string; exit:string; qty:number; entryPrice:number; exitPrice:number; pnl:number; spy:number; rrs:number; aligned:boolean; setup:string; tags:string[]; notes:string; grade:string; assetType?:"equity"|"option"; contract?:string; optionType?:"call"|"put"; strike?:number; expiration?:string; multiplier?:number };

type FillIn = {
  id: string;
  assetType: "equity" | "option";
  symbol: string;
  side: "buy" | "sell";
  effect?: "open" | "close";
  qty: number;
  price: number;
  time: string;
  optionId?: string;
  optionType?: "call" | "put";
  strike?: number;
  expiration?: string;
  contract?: string;
};

async function readSelfHostedFile(): Promise<TradeRecord[]> {
  const fs = await import("node:fs/promises"), path = await import("node:path");
  const directory = process.env.EDGELOG_DATA_DIR || ".edgelog-data", file = path.join(directory, "trades.json");
  try { return JSON.parse(await fs.readFile(file, "utf8")) as TradeRecord[]; } catch { return []; }
}
async function writeSelfHostedFile(trades: TradeRecord[]) {
  const fs = await import("node:fs/promises"), path = await import("node:path");
  const directory = process.env.EDGELOG_DATA_DIR || ".edgelog-data", file = path.join(directory, "trades.json"), temp = path.join(directory, "trades.tmp");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temp, JSON.stringify(trades, null, 2), "utf8");
  await fs.rename(temp, file);
}

type Position = { qty: number; avg: number; opened: string; side: "Long" | "Short" };

function pairEquities(fills: FillIn[]): TradeRecord[] {
  const bySymbol = new Map<string, FillIn[]>();
  for (const f of fills) { const list = bySymbol.get(f.symbol) || []; list.push(f); bySymbol.set(f.symbol, list); }
  const out: TradeRecord[] = [];
  for (const [symbol, list] of bySymbol) {
    list.sort((a, b) => +new Date(a.time) - +new Date(b.time));
    let pos: Position | null = null;
    for (const f of list) {
      if (!pos) { pos = { qty: f.qty, avg: f.price, opened: f.time, side: f.side === "buy" ? "Long" : "Short" }; continue; }
      const closes = (pos.side === "Long" && f.side === "sell") || (pos.side === "Short" && f.side === "buy");
      if (closes) {
        const q = Math.min(pos.qty, f.qty);
        const pnl = (pos.side === "Long" ? f.price - pos.avg : pos.avg - f.price) * q;
        out.push({ id: `RH-${symbol}-${f.id}`, symbol, side: pos.side, entry: pos.opened, exit: f.time, qty: q, entryPrice: pos.avg, exitPrice: f.price, pnl, spy: 0, rrs: 0, aligned: false, setup: "Imported — review needed", tags: ["Robinhood", "Needs review"], notes: "Auto-imported from Robinhood order history.", grade: "—" });
        pos.qty -= q;
        if (pos.qty <= 0) pos = null;
      } else {
        pos.avg = (pos.avg * pos.qty + f.price * f.qty) / (pos.qty + f.qty);
        pos.qty += f.qty;
        pos.opened = pos.opened < f.time ? pos.opened : f.time;
      }
    }
  }
  return out;
}

function pairOptions(fills: FillIn[]): TradeRecord[] {
  const byContract = new Map<string, FillIn[]>();
  for (const f of fills) { const key = f.optionId || `${f.symbol}:${f.strike}:${f.optionType}:${f.expiration}`; const list = byContract.get(key) || []; list.push(f); byContract.set(key, list); }
  const out: TradeRecord[] = [];
  for (const list of byContract.values()) {
    list.sort((a, b) => +new Date(a.time) - +new Date(b.time));
    let pos: Position | null = null;
    for (const f of list) {
      if (f.effect === "open") {
        if (!pos) pos = { qty: f.qty, avg: f.price, opened: f.time, side: f.side === "buy" ? "Long" : "Short" };
        else { pos.avg = (pos.avg * pos.qty + f.price * f.qty) / (pos.qty + f.qty); pos.qty += f.qty; }
        continue;
      }
      if (!pos) continue;
      const q = Math.min(pos.qty, f.qty);
      const pnl = (pos.side === "Long" ? f.price - pos.avg : pos.avg - f.price) * q * 100;
      out.push({ id: `RH-OPT-${f.id}`, symbol: f.symbol, side: pos.side, entry: pos.opened, exit: f.time, qty: q, entryPrice: pos.avg, exitPrice: f.price, pnl, spy: 0, rrs: 0, aligned: false, setup: "Imported — review needed", tags: ["Robinhood", "Needs review"], notes: "Auto-imported from Robinhood order history.", grade: "—", assetType: "option", contract: f.contract, optionType: f.optionType, strike: f.strike, expiration: f.expiration, multiplier: 100 });
      pos.qty -= q;
      if (pos.qty <= 0) pos = null;
    }
  }
  return out;
}

export async function POST(request: Request) {
  const body = (await request.json()) as { fills?: FillIn[] };
  if (!Array.isArray(body.fills) || !body.fills.length) return Response.json({ error: "fills[] is required" }, { status: 400 });

  const generated = [...pairEquities(body.fills.filter((f) => f.assetType === "equity")), ...pairOptions(body.fills.filter((f) => f.assetType === "option"))];
  const existing = await readSelfHostedFile();
  const existingIds = new Set(existing.map((t) => t.id));
  const fresh = generated.filter((t) => !existingIds.has(t.id)).sort((a, b) => +new Date(b.exit) - +new Date(a.exit));

  if (fresh.length) await writeSelfHostedFile([...fresh, ...existing]);

  return Response.json({ imported: fresh.length, skippedExisting: generated.length - fresh.length, totalTrades: existing.length + fresh.length });
}
