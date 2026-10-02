type BarInput = { t: number; o: number; h: number; l: number; c: number; v: number };
type Store = Record<string, BarInput[]>;

const VALID_INTERVALS = new Set(["5minute", "day"]);

function storePath() {
  const directory = process.env.EDGELOG_DATA_DIR || ".edgelog-data";
  return { directory };
}

async function readStore(): Promise<Store> {
  const fs = await import("node:fs/promises"), path = await import("node:path");
  const { directory } = storePath(), file = path.join(directory, "market-bars.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Store;
  } catch {
    return {};
  }
}

async function writeStore(store: Store) {
  const fs = await import("node:fs/promises"), path = await import("node:path");
  const { directory } = storePath(), file = path.join(directory, "market-bars.json"), temp = path.join(directory, "market-bars.tmp");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temp, JSON.stringify(store), "utf8");
  await fs.rename(temp, file);
}

const validBar = (b: unknown): b is BarInput => {
  if (typeof b !== "object" || b === null) return false;
  const r = b as Record<string, unknown>;
  return [r.t, r.o, r.h, r.l, r.c].every((x) => typeof x === "number" && Number.isFinite(x));
};

export async function GET(request: Request) {
  const store = await readStore();
  const params = new URL(request.url).searchParams;
  if (params.has("symbol")) {
    const symbol = params.get("symbol")!.toUpperCase(), interval = params.get("interval") || "5minute";
    const from = Number(params.get("from")), to = Number(params.get("to"));
    if (!/^[A-Z0-9.^-]{1,20}$/.test(symbol) || !VALID_INTERVALS.has(interval) || !params.has("from") || !params.has("to")
      || !Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 31 * 86400000) {
      return Response.json({ error: "Specify a valid symbol, interval, and range of up to 31 days." }, { status: 400 });
    }
    const bars = (store[`${symbol}:${interval}`] || []).filter(b => validBar(b) && b.t >= from && b.t <= to).sort((a, b) => a.t - b.t);
    return Response.json({ symbol, interval, source: "Imported bar cache", bars }, { headers: { "Cache-Control": "no-store" } });
  }
  const summary = Object.fromEntries(
    Object.entries(store).map(([key, bars]) => [key, { count: bars.length, from: bars[0]?.t, to: bars.at(-1)?.t }])
  );
  return Response.json({ cached: summary });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { symbol?: string; interval?: string; bars?: unknown[] };
  if (!body.symbol || !VALID_INTERVALS.has(body.interval || "") || !Array.isArray(body.bars)) {
    return Response.json({ error: "symbol, interval ('5minute'|'day'), and bars[] are required" }, { status: 400 });
  }
  const incoming = body.bars.filter(validBar).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }));
  if (!incoming.length) return Response.json({ error: "no valid bars in payload" }, { status: 400 });

  const key = `${body.symbol.toUpperCase()}:${body.interval}`;
  const store = await readStore();
  const existing = store[key] || [];
  const byTime = new Map(existing.map((b) => [b.t, b]));
  for (const bar of incoming) byTime.set(bar.t, bar);
  store[key] = [...byTime.values()].sort((a, b) => a.t - b.t);
  await writeStore(store);

  return Response.json({ key, stored: store[key].length, added: incoming.length });
}
