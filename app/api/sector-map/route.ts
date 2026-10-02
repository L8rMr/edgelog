import { resolveSectorEtf } from "../../../lib/sector-map";

type Entry = { sector: string | null; industry: string | null; etf: string | null };
type Store = Record<string, Entry>;

async function readStore(): Promise<Store> {
  const fs = await import("node:fs/promises"), path = await import("node:path");
  const directory = process.env.EDGELOG_DATA_DIR || ".edgelog-data", file = path.join(directory, "sector-map.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Store;
  } catch {
    return {};
  }
}

async function writeStore(store: Store) {
  const fs = await import("node:fs/promises"), path = await import("node:path");
  const directory = process.env.EDGELOG_DATA_DIR || ".edgelog-data", file = path.join(directory, "sector-map.json"), temp = path.join(directory, "sector-map.tmp");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(temp, file);
}

export async function GET() {
  return Response.json({ mapped: await readStore() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { symbols?: { symbol?: string; sector?: string | null; industry?: string | null }[] };
  if (!Array.isArray(body.symbols) || !body.symbols.length) return Response.json({ error: "symbols[] is required" }, { status: 400 });

  const store = await readStore();
  let updated = 0;
  for (const s of body.symbols) {
    if (!s.symbol) continue;
    const sector = s.sector ?? null, industry = s.industry ?? null;
    store[s.symbol.toUpperCase()] = { sector, industry, etf: resolveSectorEtf(sector, industry) };
    updated++;
  }
  await writeStore(store);
  return Response.json({ updated, total: Object.keys(store).length });
}
