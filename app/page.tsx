"use client";
import { useEffect as reactUseEffect, useRef, useState as reactUseState } from "react";
import { createPortal } from "react-dom";
import type { RdtAnalysis } from "../lib/rdt";
import type { Trade, ReviewSummary } from "../lib/journal";
import { cohortSummary, checkSummary } from "../lib/journal";
import { TradeReview, ReviewQueue, ReviewShortcut } from "./trade-review";
type View = "overview" | "reviews" | "trades" | "calendar" | "analytics" | "playbook" | "settings";
type Timeframe = "7D" | "30D" | "90D" | "YTD" | "ALL" | "CUSTOM";
const seedTrades: Trade[] = [
    { id: "T-1057", symbol: "NVDA", side: "Long", entry: "2026-08-17T10:51", exit: "2026-08-17T13:24", qty: 200, entryPrice: 178.42, exitPrice: 181.31, pnl: 578, spy: .72, rrs: 2.1, aligned: true, setup: "D1 breakout", tags: ["A+ setup", "SPY aligned"], notes: "Waited for the opening range and a retest above VWAP.", grade: "A" },
    { id: "T-1056", symbol: "TSLA", side: "Short", entry: "2026-08-15T11:18", exit: "2026-08-15T14:42", qty: 120, entryPrice: 333.8, exitPrice: 329.55, pnl: 510, spy: -.41, rrs: -1.7, aligned: true, setup: "Relative weakness", tags: ["RW", "Trend day"], notes: "Weak through SPY bounce. Covered into prior-day low.", grade: "A-" },
    { id: "T-1055", symbol: "AMD", side: "Long", entry: "2026-08-14T09:47", exit: "2026-08-14T10:22", qty: 250, entryPrice: 181.1, exitPrice: 179.96, pnl: -285, spy: -.28, rrs: .4, aligned: false, setup: "Early breakout", tags: ["Too early", "Counter trend"], notes: "Entered before market direction was clear. No persistent RS.", grade: "D" },
    { id: "T-1054", symbol: "META", side: "Long", entry: "2026-08-13T11:06", exit: "2026-08-13T15:12", qty: 80, entryPrice: 762.3, exitPrice: 768.8, pnl: 520, spy: .55, rrs: 1.8, aligned: true, setup: "Compression break", tags: ["RS", "Patient entry"], notes: "Strong sector and clear void to the next daily level.", grade: "A" },
    { id: "T-1053", symbol: "AAPL", side: "Long", entry: "2026-08-12T12:03", exit: "2026-08-12T14:16", qty: 150, entryPrice: 229.18, exitPrice: 230.72, pnl: 231, spy: .31, rrs: 1.2, aligned: true, setup: "VWAP reclaim", tags: ["RS", "VWAP"], notes: "Good confirmation; exit was a little early.", grade: "B+" },
    { id: "T-1052", symbol: "PLTR", side: "Short", entry: "2026-08-11T10:58", exit: "2026-08-11T11:44", qty: 200, entryPrice: 187.42, exitPrice: 188.36, pnl: -188, spy: .62, rrs: -.6, aligned: false, setup: "Failed high", tags: ["Counter trend"], notes: "Stock was weak but not weak enough to fight a strong tape.", grade: "C-" },
    { id: "T-1051", symbol: "GOOGL", side: "Long", entry: "2026-08-08T11:20", exit: "2026-08-08T15:33", qty: 110, entryPrice: 201.16, exitPrice: 204.85, pnl: 405.9, spy: .48, rrs: 1.5, aligned: true, setup: "D1 continuation", tags: ["RS", "Swingable"], notes: "Clean daily, held half into close.", grade: "A-" },
    { id: "T-1050", symbol: "MSFT", side: "Long", entry: "2026-08-07T13:02", exit: "2026-08-07T15:49", qty: 90, entryPrice: 520.44, exitPrice: 521.5, pnl: 95.4, spy: .16, rrs: .8, aligned: true, setup: "High of day", tags: ["Late entry"], notes: "Right direction, but poor room to target.", grade: "B-" },
    { id: "T-1049", symbol: "AMZN", side: "Short", entry: "2026-08-06T11:12", exit: "2026-08-06T14:01", qty: 180, entryPrice: 231.7, exitPrice: 229.22, pnl: 446.4, spy: -.57, rrs: -1.9, aligned: true, setup: "Support break", tags: ["RW", "SPY aligned"], notes: "Persistent weakness and expanding volume.", grade: "A" },
    { id: "T-1048", symbol: "NFLX", side: "Long", entry: "2026-08-05T10:49", exit: "2026-08-05T12:34", qty: 55, entryPrice: 1218.4, exitPrice: 1212.8, pnl: -308, spy: .08, rrs: .2, aligned: false, setup: "Range break", tags: ["Chop", "No RS"], notes: "Market was in a tight range; stock had to do all the work.", grade: "D" },
];
// Demo rows are fictional. They are flagged so they are never saved or counted as evidence.
seedTrades.forEach(trade => trade.demo = true);
// Local wrapper around React's useState. For every state except the trade ledger it
// behaves exactly like the original. When the initial value is the seedTrades array
// it also loads saved trades from /api/trades on mount (replacing the demo rows if
// any exist) and persists later changes, so the ledger syncs without a separate store.
function useState<T>(initial: T) {
    const [state, setState] = reactUseState(initial);
    const isLedger = initial === seedTrades;
    reactUseEffect(() => { if (!isLedger)
        return; fetch("/api/trades").then(r => r.ok ? r.json() : null).then(d => { if (d?.trades?.length) {
        setState(d.trades);
        const analyzed = (d.trades as Trade[]).filter(trade => trade.analysis).map(trade => ({ id: trade.id, analysis: trade.analysis }));
        if (analyzed.length)
            window.dispatchEvent(new CustomEvent("edgelog-analysis-status", { detail: { state: "done", results: analyzed, open: false } }));
    } }).catch(() => { }); }, [isLedger]);
    reactUseEffect(() => {
        if (!isLedger)
            return;
        const run = async () => {
            window.dispatchEvent(new CustomEvent("edgelog-analysis-status", { detail: { state: "running" } }));
            try {
                const all = state as unknown as Trade[];
                const current = all.filter(trade => !trade.demo && !trade.analysis);
                let next = all;
                if (current.length) {
                    const response = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trades: current }) });
                    const payload = await response.json();
                    if (!response.ok)
                        throw new Error(payload.error || "Analysis failed");
                    const byId = new Map<string, { analysis?: RdtAnalysis; error?: string }>(payload.results.map((x: { id: string; analysis?: RdtAnalysis; error?: string }) => [x.id, x]));
                    next = all.map(trade => {
                        const result = byId.get(trade.id);
                        if (!result)
                            return trade;
                        if (result.error)
                            return { ...trade, analysisError: result.error };
                        const analysis = result.analysis!;
                        const market = analysis.checks.find(c => c.key === "market");
                        const useAutomaticGrade = trade.grade === "—" || trade.tags.includes("Auto process grade");
                        return { ...trade, analysis, analysisError: undefined, rrs: analysis.metrics.intradayRrs ?? 0, spy: analysis.metrics.spyMovePct ?? 0, aligned: market?.status === "pass", setup: analysis.setup, grade: useAutomaticGrade ? analysis.displayGrade : trade.grade, tags: Array.from(new Set([...trade.tags.filter(t => t !== "Needs review" && t !== "Gate failed" && t !== "Sector unmapped"), "Analyzed bars", ...(useAutomaticGrade ? ["Auto process grade"] : []), ...(analysis.gateStatus.failed ? ["Gate failed"] : []), ...(analysis.sectorEtf ? [] : ["Sector unmapped"])])) };
                    });
                    setState(next as unknown as T);
                    fetch("/api/trades", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ trades: next.filter(trade => !trade.demo) }) }).catch(() => { });
                }
                const allResults = next.filter(trade => !trade.demo && (trade.analysis || trade.analysisError)).map(trade => ({ id: trade.id, analysis: trade.analysis, error: trade.analysisError }));
                if (!allResults.length)
                    throw new Error("Import completed trades first, then analyze. Demo rows are never presented as actual analysis.");
                window.dispatchEvent(new CustomEvent("edgelog-analysis-status", { detail: { state: "done", results: allResults, open: true } }));
            }
            catch (error) {
                window.dispatchEvent(new CustomEvent("edgelog-analysis-status", { detail: { state: "error", message: error instanceof Error ? error.message : "Analysis failed" } }));
            }
        };
        window.addEventListener("edgelog-run-analysis", run);
        return () => window.removeEventListener("edgelog-run-analysis", run);
    }, [isLedger, state]);
    const setAndPersist: typeof setState = (value) => setState(previous => { const next = typeof value === "function" ? (value as (p: T) => T)(previous) : value; if (isLedger)
        fetch("/api/trades", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ trades: (next as unknown as Trade[]).filter(trade => !trade.demo) }) }).catch(() => { }); return next; });
    return [state, setAndPersist] as const;
}
const nav: {
    id: View;
    label: string;
    icon: string;
}[] = [{ id: "overview", label: "Overview", icon: "▦" }, { id: "trades", label: "Trades", icon: "↗" }, { id: "reviews", label: "Reviews", icon: "✓" }, { id: "calendar", label: "Calendar", icon: "□" }, { id: "analytics", label: "Reports", icon: "⌁" }, { id: "playbook", label: "Playbook", icon: "◫" }, { id: "settings", label: "Settings", icon: "⚙" }];
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const clock = (s: string) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const parseCsv = (text: string) => { const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false; for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
        if (quoted && text[i + 1] === '"') {
            cell += '"';
            i++;
        }
        else
            quoted = !quoted;
    }
    else if (c === "," && !quoted) {
        row.push(cell.trim());
        cell = "";
    }
    else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && text[i + 1] === "\n")
            i++;
        row.push(cell.trim());
        if (row.some(Boolean))
            rows.push(row);
        row = [];
        cell = "";
    }
    else
        cell += c;
} if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
} return rows; };
const OPTION_DESC_RE = /^(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(Call|Put)\s+\$?([\d,.]+)\s*$/i;
function parseOptionDescription(desc: string): { expiration: string; optionType: "call" | "put"; strike: number } | null {
    const m = OPTION_DESC_RE.exec(desc.trim());
    if (!m)
        return null;
    const [mo, da, yr] = m[2].split("/").map(Number);
    return { expiration: `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`, optionType: m[3].toLowerCase() === "call" ? "call" : "put", strike: Number(m[4].replace(/,/g, "")) };
}
function importBrokerCsv(text: string, broker: string): Trade[] { const rows = parseCsv(text); if (rows.length < 2)
    return []; const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, "")); const get = (r: string[], ...names: string[]) => { const i = headers.findIndex(h => names.includes(h)); return i >= 0 ? r[i] : ""; }; const fills = rows.slice(1).map((r, i) => ({ symbol: get(r, "symbol", "instrument", "underlying").split(" ")[0].toUpperCase(), action: get(r, "side", "transcode", "action", "buysell").toUpperCase(), option: parseOptionDescription(get(r, "description")), qty: Math.abs(Number(get(r, "qty", "quantity", "filledqty").replace(/[^0-9.-]/g, ""))) || 0, price: Math.abs(Number(get(r, "price", "fillprice", "netprice").replace(/[^0-9.-]/g, ""))) || 0, date: get(r, "exectime", "activitydate", "date", "tradetime", "processdate") || new Date().toISOString(), i })).filter(f => f.symbol && f.qty && f.price); const positions = new Map<string, {
    qty: number;
    avg: number;
    opened: string;
    side: "Long" | "Short";
    option: ReturnType<typeof parseOptionDescription>;
}>(), out: Trade[] = []; for (const f of fills) {
    const buy = /BUY|BOT|BTO|BTC/.test(f.action), sell = /SELL|SOLD|STC|SSHORT|STO/.test(f.action);
    if (!buy && !sell)
        continue;
    const key = f.option ? `${f.symbol}:${f.option.strike}:${f.option.optionType}:${f.option.expiration}` : f.symbol;
    const p = positions.get(key);
    if (!p) {
        positions.set(key, { qty: f.qty, avg: f.price, opened: f.date, side: buy ? "Long" : "Short", option: f.option });
        continue;
    }
    const closes = (p.side === "Long" && sell) || (p.side === "Short" && buy);
    if (closes) {
        const mult = p.option ? 100 : 1, q = Math.min(p.qty, f.qty), pnl = (p.side === "Long" ? f.price - p.avg : p.avg - f.price) * q * mult;
        out.push({ id: `${broker.slice(0, 2).toUpperCase()}-${Date.now()}-${f.i}`, symbol: f.symbol, side: p.side, entry: p.opened, exit: f.date, qty: q, entryPrice: p.avg, exitPrice: f.price, pnl, spy: 0, rrs: 0, aligned: false, setup: "Imported — review needed", tags: [broker, "Needs review"], notes: "Imported fill. Add SPY context and grade your process.", grade: "—", ...(p.option ? { assetType: "option" as const, contract: `${f.symbol} ${p.option.strike}${p.option.optionType === "call" ? "C" : "P"} ${Number(p.option.expiration.slice(5, 7))}/${Number(p.option.expiration.slice(8, 10))}`, optionType: p.option.optionType, strike: p.option.strike, expiration: p.option.expiration, multiplier: 100 } : {}) });
        p.qty -= q;
        if (p.qty <= 0)
            positions.delete(key);
    }
    else {
        p.avg = ((p.avg * p.qty) + (f.price * f.qty)) / (p.qty + f.qty);
        p.qty += f.qty;
    }
} return out; }
export default function Home() {
    const [view, setView] = useState<View>("overview"), [trades, setTrades] = useState(seedTrades), [selected, setSelected] = useState<Trade | null>(null), [importOpen, setImportOpen] = useState(false), [broker, setBroker] = useState("Robinhood"), [query, setQuery] = useState(""), [tag, setTag] = useState("All tags"), [toast, setToast] = useState(""), [timeframe, setTimeframe] = useState<Timeframe>("30D"), [customStart, setCustomStart] = useState(""), [customEnd, setCustomEnd] = useState("");
    const [reviews, setReviews] = reactUseState<Record<string, ReviewSummary>>({});
    const [reviewsReady, setReviewsReady] = reactUseState(false), [reviewsError, setReviewsError] = reactUseState(""), [reviewRetry, setReviewRetry] = reactUseState(0), [editingTrade, setEditingTrade] = reactUseState(false);
    reactUseEffect(() => {
        const controller = new AbortController();
        setReviewsError("");
        fetch("/api/reviews", { signal: controller.signal }).then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error); return payload.reviews as ReviewSummary[]; }).then(rows => { setReviews(Object.fromEntries(rows.map(row => [row.tradeId, row]))); setReviewsReady(true); }).catch(error => { if (error.name !== "AbortError") setReviewsError(error.message || "Reviews could not be loaded."); });
        return () => controller.abort();
    }, [reviewRetry]);
    const fileRef = useRef<HTMLInputElement>(null), now = Date.now();
    const start = timeframe === "CUSTOM" ? (customStart ? new Date(customStart + "T00:00").getTime() : 0) : timeframe === "ALL" ? 0 : timeframe === "YTD" ? new Date(new Date().getFullYear(), 0, 1).getTime() : now - Number(timeframe.slice(0, -1)) * 86400000;
    const end = timeframe === "CUSTOM" && customEnd ? new Date(customEnd + "T23:59:59.999").getTime() : now;
    const periodTrades = trades.filter(trade => { const t = new Date(trade.exit).getTime(); return t >= start && t <= end; }), wins = periodTrades.filter(t => t.pnl > 0), losses = periodTrades.filter(t => t.pnl < 0), net = periodTrades.reduce((s, t) => s + t.pnl, 0), grossWin = wins.reduce((s, t) => s + t.pnl, 0), grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const metrics = { net, winRate: periodTrades.length ? wins.length / periodTrades.length * 100 : 0, pf: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0, avg: periodTrades.length ? net / periodTrades.length : 0 }, allTags = Array.from(new Set(periodTrades.flatMap(t => t.tags))).sort(), filtered = periodTrades.filter(t => (t.symbol.includes(query.toUpperCase()) || t.setup.toLowerCase().includes(query.toLowerCase())) && (tag === "All tags" || t.tags.includes(tag))), aligned = periodTrades.filter(t => t.aligned), misaligned = periodTrades.filter(t => !t.aligned), alignedWin = aligned.filter(t => t.pnl > 0).length / Math.max(1, aligned.length) * 100, misWin = misaligned.filter(t => t.pnl > 0).length / Math.max(1, misaligned.length) * 100;
    const showToast = (s: string) => { setToast(s); setTimeout(() => setToast(""), 2800); }; const handleFile = async (file?: File) => { if (!file)
    return; const imported = importBrokerCsv(await file.text(), broker); if (!imported.length) {
    showToast("No completed round-trip trades found. Check the broker format.");
    return;
} setTrades(t => [...imported, ...t]); setImportOpen(false); showToast(`${imported.length} completed trade${imported.length === 1 ? "" : "s"} imported from ${broker}`); setView("trades"); }; const saveTrade = (next: Trade) => { setTrades(ts => ts.map(t => t.id === next.id ? next : t)); setSelected(next); showToast("Trade journal updated"); }; const deleteTrade = (id: string) => { setTrades(ts => ts.filter(t => t.id !== id)); setSelected(null); showToast("Trade deleted"); }; const addManualTrade = (t: Trade) => { setTrades(ts => [t, ...ts]); setImportOpen(false); showToast(`Trade added: ${t.symbol}`); setView("trades"); }; const addImportedTrades = (imported: Trade[]) => { setTrades(ts => [...imported, ...ts]); setImportOpen(false); showToast(`${imported.length} trade${imported.length === 1 ? "" : "s"} imported`); setView("trades"); }; return <main className="shell"><aside className="sidebar"><div className="brand"><span>↗</span> EDGELOG</div><nav>{nav.map(n => <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => setView(n.id)}>{n.icon}<span>{n.label}</span></button>)}</nav><div className="side-bottom"><div className="privacy"><i /> SELF-HOSTED<br /><small>Your data stays with you</small></div><div className="account"><b>AL</b><span>Alen<br /><small>Active trader</small></span></div></div></aside><section className="workspace"><header><div><p className="eyebrow">{view === "overview" ? "TRADING JOURNAL" : view.toUpperCase()}</p><h1>{view === "overview" ? "Good morning, Alen" : nav.find(n => n.id === view)?.label}</h1></div><div className="actions">{view !== "settings" && <><select className="timeframe-select" value={timeframe} onChange={event => setTimeframe(event.target.value as Timeframe)} aria-label="Dashboard timeframe"><option value="7D">Last 7 days</option><option value="30D">Last 30 days</option><option value="90D">Last 90 days</option><option value="YTD">Year to date</option><option value="ALL">All time</option><option value="CUSTOM">Custom range…</option></select>{timeframe === "CUSTOM" && <div className="date-range"><input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} aria-label="Start date"/><span>–</span><input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} aria-label="End date"/></div>}</>}<button className="primary" onClick={() => setImportOpen(true)}>＋ Import trades</button></div></header>{view === "overview" && reviewsReady && <ReviewShortcut trades={periodTrades} reviews={reviews} open={() => setView("reviews")}/>} {(view === "overview" || view === "reviews") && reviewsError && <p className="review-error" role="alert">{reviewsError} <button onClick={() => setReviewRetry(n => n + 1)}>Retry reviews</button></p>} {view === "reviews" && (reviewsReady ? <ReviewQueue trades={periodTrades} reviews={reviews} onSelect={setSelected}/> : !reviewsError && <p role="status">Loading review queue…</p>)} {view === "overview" && <Overview trades={periodTrades} metrics={metrics} alignedWin={alignedWin} onSelect={setSelected} go={setView}/>} {view === "trades" && <TradesView trades={filtered} query={query} setQuery={setQuery} tag={tag} setTag={setTag} allTags={allTags} onSelect={setSelected}/>} {view === "calendar" && <CalendarView trades={periodTrades} onSelect={setSelected}/>} {view === "analytics" && <Analytics trades={periodTrades} alignedWin={alignedWin} misWin={misWin}/>} {view === "playbook" && <Playbook />}{view === "settings" && <Settings onImport={b => { setBroker(b); setImportOpen(true); }}/>}</section>{importOpen && <ImportModal broker={broker} setBroker={setBroker} close={() => setImportOpen(false)} fileRef={fileRef} handleFile={handleFile} onManualAdd={addManualTrade} onJsonAdd={addImportedTrades}/>} {selected && (editingTrade ? <TradeDrawer key={selected.id} trade={selected} close={() => setEditingTrade(false)} save={saveTrade} onDelete={id => { deleteTrade(id); setEditingTrade(false); }}/> : <TradeReview key={selected.id} trade={selected} close={() => setSelected(null)} onEdit={() => setEditingTrade(true)} onSaved={review => { setReviews(previous => ({ ...previous, [review.tradeId]: review })); showToast("Review saved"); }}/>) } {toast && <div className="toast">✓ {toast}</div>}</main>; }
function Overview({ trades, metrics, alignedWin, onSelect, go }: {
    trades: Trade[];
    metrics: {
        net: number;
        winRate: number;
        pf: number;
        avg: number;
    };
    alignedWin: number;
    onSelect: (t: Trade) => void;
    go: (v: View) => void;
}) {
    const analyzed = trades.filter(t => !t.demo && t.analysis), scores = analyzed.map(t => t.analysis?.score).filter((x): x is number => x !== null && x !== undefined), score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, passRate = (key: string) => { const verified = analyzed.map(t => t.analysis?.checks.find(c => c.key === key)).filter((c): c is NonNullable<typeof c> => !!c && c.status !== "unverified"); return verified.length ? verified.filter(c => c.status === "pass").length / verified.length * 100 : null; }, rvols = analyzed.map(t => t.analysis?.metrics.rvol).filter((x): x is number => x !== null && x !== undefined), averageRvol = rvols.length ? rvols.reduce((a, b) => a + b, 0) / rvols.length : null, failures = analyzed.flatMap(t => t.analysis?.checks.filter(c => c.status === "fail") || []), leak = failures.reduce<Record<string, number>>((a, c) => { a[c.label] = (a[c.label] || 0) + 1; return a; }, {}), topLeak = Object.entries(leak).sort((a, b) => b[1] - a[1])[0]?.[0];
    const alignedCohort = cohortSummary(trades, "market");
    const gateFailed = analyzed.filter(t => t.analysis?.gateStatus.failed), gateFailedWon = gateFailed.filter(t => t.pnl > 0), gateFailedLost = gateFailed.filter(t => t.pnl < 0);
    return <><div className="market-strip"><span><i className="up"/> MARKET EVIDENCE <b>{analyzed.length ? `${analyzed.length} actual trade${analyzed.length === 1 ? "" : "s"}` : "Awaiting imported trades"}</b></span><span>Source <b className="green">{analyzed[0]?.analysis?.provider || "Not analyzed"}</b></span><span>Look-ahead protection <b>Enabled</b></span><span className="align">Verified completeness <b>{analyzed.length ? `${Math.round(analyzed.reduce((n, t) => n + (t.analysis?.completeness || 0), 0) / analyzed.length)}%` : "—"}</b></span></div><section className="stats"><Stat label="NET P&L" value={money(metrics.net)} meta={trades.some(t => t.demo) ? "Demo data" : "Realized"} foot={`${trades.length} closed trades`}/><Stat label="WIN RATE" value={`${metrics.winRate.toFixed(1)}%`} meta="Outcome" foot={`${trades.filter(t => t.pnl > 0).length} of ${trades.length} trades`}/><Stat label="PROFIT FACTOR" value={Number.isFinite(metrics.pf)?metrics.pf.toFixed(2):"∞"} meta={metrics.pf >= 2 ? "Healthy" : "Review"} foot={`${Number.isFinite(metrics.pf)?metrics.pf.toFixed(2):"∞"} won per $1 lost`}/><Stat label="AVG. TRADE" value={money(metrics.avg)} meta="Per trade" foot={`${trades.length} closed trades`}/></section><section className="grid"><article className="panel equity"><div className="panel-title"><div><p>EQUITY CURVE</p><h2 className={metrics.net >= 0 ? "positive" : "negative"}>{money(metrics.net)} <span>NET REALIZED</span></h2></div><small className="chart-hint">Hover for trade details</small></div><EquityCurve trades={trades}/></article><article className={`panel rdt ${score === null ? "score-empty" : score >= 75 ? "score-strong" : "score-caution"}`}><div className="panel-title"><div><p>RDT PROCESS SCORE</p><h2>{score ?? "—"} <span>{score === null ? "ANALYZE IMPORTS" : "/ 100"}</span></h2></div><b className="score">{score === null ? "No evidence" : score >= 75 ? "Strong" : score >= 55 ? "Developing" : "Needs work"}</b></div><p className="sample-note">Computed from {scores.length} scored trades</p><div className="meter" role="meter" aria-label="Verified RDT process score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score ?? undefined}><i style={{ width: `${score || 0}%` }}/></div><ul><li><span>SPY alignment</span><b>{passRate("market") === null ? "—" : `${passRate("market")!.toFixed(0)}% · n=${checkSummary(trades, "market").count}`}</b></li><li><span>Persistent RS/RW</span><b>{passRate("intraday_rrs") === null ? "—" : `${passRate("intraday_rrs")!.toFixed(0)}% · n=${checkSummary(trades, "intraday_rrs").count}`}</b></li><li><span>Entries after 10:45</span><b>{passRate("time") === null ? "—" : `${passRate("time")!.toFixed(0)}% · n=${checkSummary(trades, "time").count}`}</b></li><li><span>Avg. relative volume</span><b>{averageRvol === null ? "—" : `${averageRvol.toFixed(2)}× · n=${rvols.length}`}</b></li></ul><button className="insight" onClick={() => go("analytics")}>View RDT insights <span>→</span></button></article></section><article className="panel recent"><div className="panel-title"><div><p>RECENT TRADES</p><h2>Latest journal entries</h2></div><button onClick={() => go("trades")}>View all →</button></div><TradeTable trades={trades.slice(0, 5)} onSelect={onSelect}/></article><section className="insights-row"><article className="callout good"><span>↗</span><div><p>WHAT’S VERIFIED</p><b>{alignedCohort.count ? `SPY-aligned setups: ${alignedCohort.winRate!.toFixed(0)}% win rate` : "No verified SPY-aligned trades in this timeframe"}</b><small>{alignedCohort.count ? `${alignedCohort.wins} wins / ${alignedCohort.count} trades. Computed at entry; this is a historical sample, not a forecast.` : "Only non-demo trades with a computed SPY alignment pass are counted."}</small></div></article><article className="callout warn"><span>!</span><div><p>PROCESS LEAK</p><b>{topLeak || "No verified process leak yet"}</b><small>{topLeak ? `${leak[topLeak]} failures across ${analyzed.filter(t => t.analysis?.checks.some(c => c.label === topLeak && c.status !== "unverified")).length} trades with this check verified.` : "Failures will appear only after the supporting bars have been analyzed."}</small></div></article><article className="callout warn"><span>⛔</span><div><p>PROCESS VS OUTCOME</p><b>{gateFailed.length ? `${gateFailedWon.length} won, ${gateFailedLost.length} lost, ${gateFailed.filter(t => t.pnl === 0).length} flat · n=${gateFailed.length}` : "No gate-failed trades yet"}</b><small>{gateFailed.length ? `Won despite failing a gate: ${money(gateFailedWon.reduce((s, t) => s + t.pnl, 0))} · Lost after failing a gate: ${money(gateFailedLost.reduce((s, t) => s + t.pnl, 0))}` : "Tracks trades that broke a hard gate (time, data, or room) regardless of P&L."}</small></div></article></section></>;
}
function Stat({ label, value, meta, foot }: {
    label: string;
    value: string;
    meta: string;
    foot: string;
}) { return <article><p>{label}</p><strong>{value}</strong><em className={meta === "Review" ? "stat-review" : ""}>{meta}</em><small>{foot}</small></article>; }
function EquityCurve({ trades }: { trades: Trade[] }) {
    const [hovered, setHovered] = useState<number | null>(null), ordered = trades.slice().sort((a, b) => new Date(a.exit).getTime() - new Date(b.exit).getTime());
    let cumulative = 0;
    const raw = ordered.map(trade => ({ trade, value: cumulative += trade.pnl, time: new Date(trade.exit).getTime() }));
    if (!raw.length)
        return <div className="chart chart-empty">No closed trades in this timeframe.</div>;
    const values = [0, ...raw.map(point => point.value)], rawMin = Math.min(...values), rawMax = Math.max(...values), spread = Math.max(rawMax - rawMin, 10), domainMin = rawMin - spread * .12, domainMax = rawMax + spread * .12, minTime = raw[0].time, maxTime = raw.at(-1)!.time, timeSpan = Math.max(maxTime - minTime, 1), y = (value: number) => 14 + (domainMax - value) / (domainMax - domainMin) * 182;
    const points = raw.map(point => ({ ...point, x: raw.length === 1 ? 350 : 18 + (point.time - minTime) / timeSpan * 664, y: y(point.value) })), baselineY = y(0), polyline = points.map(point => `${point.x},${point.y}`).join(" "), selected = hovered === null ? null : points[hovered], axisPoints = Array.from(new Set([0, Math.round((points.length - 1) * .25), Math.round((points.length - 1) * .5), Math.round((points.length - 1) * .75), points.length - 1])).map(index => points[index]);
    const move = (event: React.PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(), target = (event.clientX - rect.left) / rect.width * 700, nearest = points.reduce((best, point, index) => Math.abs(point.x - target) < Math.abs(points[best].x - target) ? index : best, 0); setHovered(nearest); };
    return <div className="chart interactive-chart" onPointerMove={move} onPointerLeave={() => setHovered(null)}><div className="gridlines"/><svg viewBox="0 0 700 220" preserveAspectRatio="none" role="img" aria-label="Interactive cumulative realized profit chart"><defs><linearGradient id="positive-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#41d79a" stopOpacity=".22"/><stop offset="1" stopColor="#41d79a" stopOpacity="0"/></linearGradient><linearGradient id="negative-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6477" stopOpacity=".18"/><stop offset="1" stopColor="#ff6477" stopOpacity="0"/></linearGradient></defs><line className="zero-line" x1="0" y1={baselineY} x2="700" y2={baselineY}/><polygon className="area" style={{ fill: `url(#${raw.at(-1)!.value >= 0 ? "positive-fill" : "negative-fill"})` }} points={`${points[0].x},${baselineY} ${polyline} ${points.at(-1)!.x},${baselineY}`}/>{points.slice(1).map((point, index) => <line key={point.trade.id} className="curve-segment" x1={points[index].x} y1={points[index].y} x2={point.x} y2={point.y} stroke={point.value >= 0 ? "#41d79a" : "#ff6477"}/>) }{points.length === 1 && <circle cx={points[0].x} cy={points[0].y} r="3" fill={points[0].value >= 0 ? "#41d79a" : "#ff6477"}/>} {selected && <><line className="hover-guide" x1={selected.x} y1="8" x2={selected.x} y2="204"/><circle className="hover-dot" cx={selected.x} cy={selected.y} r="5" fill={selected.trade.pnl >= 0 ? "#41d79a" : "#ff6477"}/></>}</svg>{selected && <div className="chart-tooltip" style={{ left: `${Math.min(88, Math.max(12, selected.x / 7))}%` }}><b>{selected.trade.symbol} · {selected.trade.side}</b><small>{new Date(selected.trade.exit).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small><span className={selected.trade.pnl >= 0 ? "pos" : "neg"}>Trade {money(selected.trade.pnl)}</span><span className={selected.value >= 0 ? "pos" : "neg"}>Cumulative {money(selected.value)}</span><em>{selected.trade.setup} · {selected.trade.side==="Short"?"RW":"RS"} vs SPY {selected.trade.rrs.toFixed(2)}</em></div>}<div className="axis">{axisPoints.map(point => <span key={point.trade.id}>{new Date(point.time).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}</span>)}</div></div>;
}
const gateSummary = (a: RdtAnalysis) => a.gateStatus.failed ? `Gate failed: ${a.gateStatus.reasons.join(", ")} · Quality score ${a.qualityScore ?? "—"} (${a.qualityGrade})` : `Quality score: ${a.qualityScore ?? "—"} (${a.qualityGrade})`;
function GradeBadge({ trade }: { trade: Trade }) {
    const [pos, setPos] = useState<{ top: number; left: number; flip: boolean } | null>(null), ref = useRef<HTMLSpanElement>(null);
    const show = () => { const rect = ref.current?.getBoundingClientRect(); if (!rect)
        return; const flip = window.innerHeight - rect.bottom < 190, left = Math.min(Math.max(rect.left + rect.width / 2, 140), window.innerWidth - 140); setPos({ top: flip ? rect.top - 8 : rect.bottom + 8, left, flip }); };
    const hide = () => setPos(null);
    return <span ref={ref} className="grade-trigger" tabIndex={0} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onKeyDown={e => { if (e.key === "Escape")
        hide(); }} onClick={e => e.stopPropagation()}><b className={trade.analysis?.gateStatus.failed ? "grade gate-failed" : "grade"}>{trade.grade}</b>{pos && createPortal(<div className={pos.flip ? "grade-popout flip" : "grade-popout"} style={{ top: pos.top, left: pos.left }}>{!trade.analysis ? <p>Analysis pending</p> : <><p className="rec-text">{trade.analysis.recommendation}</p><small className="gate-summary">{gateSummary(trade.analysis)}</small></>}</div>, document.body)}</span>;
}
function TradeTable({ trades, onSelect }: {
    trades: Trade[];
    onSelect: (t: Trade) => void;
}) { return <div className="table-wrap"><table><thead><tr><th>TRADE</th><th>ENTRY / EXIT</th><th>SETUP</th><th>SPY</th><th>RS / RW</th><th>GRADE</th><th>P&amp;L</th></tr></thead><tbody>{trades.map(t => <tr key={t.id} tabIndex={0} aria-label={`Review ${t.symbol} trade from ${day(t.entry)}`} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(t); } }} onClick={() => onSelect(t)}><td><b>{t.symbol}</b><small>{t.side} · {t.qty} {t.assetType==="option"?"ct":"sh"}</small></td><td>{day(t.entry)}<small>{clock(t.entry)}–{clock(t.exit)}</small></td><td>{t.setup}<small className="tags">{t.tags.slice(0, 2).map(x => <i key={x}>{x}</i>)}</small></td><td><span className={t.aligned ? "status aligned" : "status against"}>{t.aligned ? "Aligned" : "Against"}</span></td><td className={t.rrs > 0 ? "pos" : t.rrs < 0 ? "neg" : ""}>{t.side==="Short"?"RW ":"RS "}{t.rrs > 0 ? "+" : ""}{t.rrs.toFixed(1)}</td><td><GradeBadge trade={t}/></td><td className={t.pnl >= 0 ? "money pos" : "money neg"}>{money(t.pnl)}</td></tr>)}</tbody></table></div>; }
function TradesView({ trades, query, setQuery, tag, setTag, allTags, onSelect }: {
    trades: Trade[];
    query: string;
    setQuery: (s: string) => void;
    tag: string;
    setTag: (s: string) => void;
    allTags: string[];
    onSelect: (t: Trade) => void;
}) { return <><div className="toolbar"><label className="search">⌕<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search ticker or setup"/></label><select value={tag} onChange={e => setTag(e.target.value)}><option>All tags</option>{allTags.map(t => <option key={t}>{t}</option>)}</select><button>Side: All⌄</button><span>{trades.length} trades</span></div><article className="panel ledger"><TradeTable trades={trades} onSelect={onSelect}/>{!trades.length && <div className="empty">No trades match those filters.</div>}</article></>; }
function CalendarView({ trades, onSelect }: {
    trades: Trade[];
    onSelect: (t: Trade) => void;
}) { const now = new Date(), [year, setYear] = useState(now.getFullYear()), [month, setMonth] = useState(now.getMonth()), [dayView, setDayView] = useState<{ date: number; trades: Trade[] } | null>(null), first = new Date(year, month, 1).getDay(), days = new Date(year, month + 1, 0).getDate(), cells = Array.from({ length: 42 }, (_, i) => i - first + 1), byDay = new Map<number, Trade[]>(); trades.forEach(t => { const d = new Date(t.exit); if (d.getFullYear() === year && d.getMonth() === month) {
    const a = byDay.get(d.getDate()) || [];
    a.push(t);
    byDay.set(d.getDate(), a);
} }); const total = Array.from(byDay.values()).flat().reduce((s, t) => s + t.pnl, 0), prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); }, nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); }; return <><section className="calendar-head"><div><button onClick={prevMonth} aria-label="Previous month">‹</button><h2>{new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2><button onClick={nextMonth} aria-label="Next month">›</button></div><p><b>{money(total)}</b> net this month · {Array.from(byDay.values()).filter(a => a.reduce((s, t) => s + t.pnl, 0) > 0).length} green days</p></section><article className="panel calendar"><div className="weekdays">{["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map(d => <b key={d}>{d}</b>)}</div><div className="month-grid">{cells.map((d, i) => { const ts = byDay.get(d) || [], p = ts.reduce((s, t) => s + t.pnl, 0); return <div className={`${d < 1 || d > days ? "outside" : ""} ${p > 0 ? "green-day" : p < 0 ? "red-day" : ""}`} key={i}>{d > 0 && d <= days && <><span>{d}</span>{ts.length > 0 && <button onClick={() => setDayView({ date: d, trades: ts })}><b>{money(p)}</b><small>{ts.length} trade{ts.length > 1 ? "s" : ""}</small></button>}</>}</div>; })}</div></article>{dayView && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setDayView(null); }}><article className="modal"><button className="x" onClick={() => setDayView(null)}>×</button><p className="eyebrow">{new Date(year, month, dayView.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p><h2>{dayView.trades.length} trade{dayView.trades.length > 1 ? "s" : ""} · <span className={dayView.trades.reduce((s, t) => s + t.pnl, 0) >= 0 ? "pos" : "neg"}>{money(dayView.trades.reduce((s, t) => s + t.pnl, 0))}</span></h2><div className="table-wrap"><table><thead><tr><th>TRADE</th><th>ENTRY / EXIT</th><th>SETUP</th><th>GRADE</th><th>P&amp;L</th></tr></thead><tbody>{dayView.trades.map(t => <tr key={t.id} tabIndex={0} onClick={() => { onSelect(t); setDayView(null); }}><td><b>{t.symbol}</b><small>{t.side} · {t.qty} {t.assetType === "option" ? "ct" : "sh"}</small></td><td>{clock(t.entry)}–{clock(t.exit)}</td><td>{t.setup}</td><td><GradeBadge trade={t}/></td><td className={t.pnl >= 0 ? "money pos" : "money neg"}>{money(t.pnl)}</td></tr>)}</tbody></table></div></article></div>}</>; }
function Analytics({ trades, alignedWin, misWin }: {
    trades: Trade[];
    alignedWin: number;
    misWin: number;
}) {
    const analyzed = trades.filter(t => !t.demo && t.analysis), avg = (a: Trade[]) => a.reduce((s, t) => s + t.pnl, 0) / Math.max(a.length, 1), hasPass = (t: Trade, key: string) => t.analysis?.checks.find(c => c.key === key)?.status === "pass", after = analyzed.filter(t => hasPass(t, "time")), before = analyzed.filter(t => t.analysis?.checks.find(c => c.key === "time")?.status === "fail"), alignedActual = analyzed.filter(t => hasPass(t, "market")), againstActual = analyzed.filter(t => t.analysis?.checks.find(c => c.key === "market")?.status === "fail"), winRate = (a: Trade[]) => a.length ? a.filter(t => t.pnl > 0).length / a.length * 100 : 0, setups = Array.from(new Set(analyzed.map(t => t.analysis!.setup))).map(s => ({ s, p: analyzed.filter(t => t.analysis!.setup === s).reduce((n, t) => n + t.pnl, 0) })).sort((a, b) => b.p - a.p).slice(0, 5), scores = analyzed.map(t => t.analysis?.score).filter((x): x is number => x !== null && x !== undefined), score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, criteria = [["daily", "Daily chart quality"], ["intraday_rrs", "Persistent RS / RW"], ["sector", "Stacked sector"], ["rvol", "Relative volume ≥ 1.2×"], ["void", "Clear void to target"]].map(([key, label]) => { const checks = analyzed.map(t => t.analysis?.checks.find(c => c.key === key)).filter((c): c is NonNullable<typeof c> => !!c && c.status !== "unverified"); return { label, count: checks.length, value: checks.length ? checks.filter(c => c.status === "pass").length / checks.length * 100 : null }; });
    return <><section className="report-hero panel"><div><p>ACTUAL RDT PERFORMANCE LAB</p><h2>{analyzed.length ? "Your outcomes are grouped by reconstructed conditions at entry." : "Import trades, then run actual market analysis."}</h2><small>{analyzed.length ? `${analyzed.length} trades use timestamp-aligned stock, SPY, and sector bars with no future daily candles.` : "No demo percentage is treated as evidence."}</small></div><div className="big-score"><strong>{score ?? "—"}</strong><span>VERIFIED<br />SCORE</span></div></section><section className="report-grid"><article className="panel compare"><div className="panel-title"><div><p>SPY ALIGNMENT</p><h2>Trade with the market</h2></div></div><CompareRow label="Aligned with SPY" value={winRate(alignedActual)} avg={avg(alignedActual)} count={alignedActual.length}/><CompareRow label="Counter / unclear" value={winRate(againstActual)} avg={avg(againstActual)} count={againstActual.length}/><p className="takeaway">Observed difference: <b>{alignedActual.length && againstActual.length ? `${(winRate(alignedActual) - winRate(againstActual)).toFixed(0)} points` : "Not enough data to compare"}</b>. Cohort sizes: {alignedActual.length} aligned, {againstActual.length} failed alignment.</p></article><article className="panel compare"><div className="panel-title"><div><p>TIME GATE</p><h2>Patience after the open</h2></div></div><CompareRow label="After 10:45 ET" value={winRate(after)} avg={avg(after)} count={after.length}/><CompareRow label="Before 10:45 ET" value={winRate(before)} avg={avg(before)} count={before.length}/><p className="takeaway">This comparison uses the entry timestamp converted to New York market time. Cohort sizes: {after.length} after, {before.length} before.</p></article><article className="panel setup-report"><div className="panel-title"><div><p>COMPUTED SETUP EXPECTANCY</p><h2>P&amp;L by detected conditions</h2></div></div>{setups.length ? setups.map(s => <div className="bar-row" key={s.s}><span>{s.s}<small className="sample-note">n={analyzed.filter(t => t.analysis?.setup === s.s).length} trades</small></span><div><i style={{ width: `${Math.max(8, Math.abs(s.p) / Math.max(...setups.map(x => Math.abs(x.p)), 1) * 100)}%` }} className={s.p >= 0 ? "" : "loss"}/></div><b className={s.p >= 0 ? "pos" : "neg"}>{money(s.p)}</b></div>) : <p className="takeaway">No analyzed setups yet.</p>}</article><article className="panel checklist-report"><div className="panel-title"><div><p>RDT CHECKLIST</p><h2>Verified criteria compliance</h2></div></div>{criteria.map(c => <div className="check-row" key={c.label}><span>{c.label}<small className="sample-note">n={c.count} verified trades</small></span><div><i style={{ width: `${c.value || 0}%` }}/></div><b>{c.value === null ? "—" : `${c.value.toFixed(0)}%`}</b></div>)}</article></section></>;
}
function CompareRow({ label, value, avg, count }: {
    label: string;
    value: number;
    avg: number;
    count: number;
}) { return <div className="compare-row"><span>{label}</span><div><i style={{ width: `${value}%` }}/></div><b>{count ? `${value.toFixed(0)}%` : "—"}<small>{count} trades · {count ? `${money(avg)} avg` : "No evidence"}</small></b></div>; }
function Playbook() { const sections = [{ title: "Market first", items: ["After 10:45 ET — opening range has information", "SPY direction is clear; trend or range identified", "Trade direction aligns with SPY, or exceptional RS/RW is documented"] }, { title: "Daily chart", items: ["Clean trend; not gappy, choppy, or overextended from 8 EMA", "Daily RS for longs or RW for shorts is persistent (5-day window)", "Stock vs sector and sector vs SPY are stacked", "At least 1% clear void to the next meaningful level"] }, { title: "Five-minute timing", items: ["3 EMA is on the correct side of 8 EMA", "Price is on the correct side of VWAP", "Intraday RS/RW is persistent, not a single spike", "Entry is not running into a trendline or range edge"] }, { title: "Plan before entry", items: ["Technical stop marks thesis failure", "Target is the next real structure level", "Chart-derived reward:risk is at least 2:1", "Position size follows stop distance and risk budget"] }]; return <><div className="playbook-intro"><p>A repeatable pre-trade gate</p><h2>Grade the process before the outcome.</h2><small>Every required item should be checked before an entry. A win that breaks the process is still a bad trade.</small></div><section className="playbook-grid">{sections.map((s, i) => <article className="panel play-section" key={s.title}><div className="play-title"><span>{i + 1}</span><h3>{s.title}</h3><b>Required</b></div>{s.items.map(x => <label key={x}><input type="checkbox"/><span>{x}</span></label>)}</article>)}</section><article className="panel risk-card"><div><p>POSITION SIZE CALCULATOR</p><h2>Let the chart decide the size</h2></div><div className="risk-inputs"><label>Account<input defaultValue="50000"/></label><label>Risk %<input defaultValue="1.0"/></label><label>Entry<input defaultValue="100.20"/></label><label>Stop<input defaultValue="99.40"/></label><span><small>MAX SHARES</small><b>625</b></span></div></article></>; }
function Settings({ onImport }: {
    onImport: (b: string) => void;
}) { return <section className="settings-grid"><article className="panel"><div className="panel-title"><div><p>DATA SOURCES</p><h2>Broker imports</h2></div></div><div className="broker-card"><span className="rh">R</span><div><b>Robinhood</b><small>Import account activity or order-history CSV</small></div><button onClick={() => onImport("Robinhood")}>Import CSV</button></div><div className="broker-card"><span className="tos">T</span><div><b>thinkorswim</b><small>Import filled orders exported from Account Statement</small></div><button onClick={() => onImport("thinkorswim")}>Import CSV</button></div><div className="broker-card disabled"><span>↻</span><div><b>Direct broker sync</b><small>Adapter ready; credentials and a supported broker API are required</small></div><button disabled>Not configured</button></div></article><article className="panel"><div className="panel-title"><div><p>PRIVACY</p><h2>Self-hosted by design</h2></div></div><ul className="privacy-list"><li><b>Private storage</b><small>Trade records live in your own deployment.</small></li><li><b>No analytics tracking</b><small>No third-party product telemetry is included.</small></li><li><b>Portable exports</b><small>Your journal can be exported as CSV at any time.</small></li></ul></article><article className="panel"><div className="panel-title"><div><p>RDT DEFAULTS</p><h2>Analysis rules</h2></div></div><div className="form-row"><label>SPY comparison symbol<input defaultValue="SPY"/></label><label>Intraday RS/RW window<select defaultValue="12"><option>12 bars (1 hour)</option></select></label><label>Daily RS/RW window<select defaultValue="5"><option>5 sessions</option></select></label><label>Minimum RVOL<input defaultValue="1.2"/></label></div><button className="primary small">Save preferences</button></article></section>; }
function ImportModal({ broker, setBroker, close, fileRef, handleFile, onManualAdd, onJsonAdd }: {
    broker: string;
    setBroker: (s: string) => void;
    close: () => void;
    fileRef: React.RefObject<HTMLInputElement | null>;
    handleFile: (f?: File) => void;
    onManualAdd: (t: Trade) => void;
    onJsonAdd: (t: Trade[]) => void;
}) { const title = broker === "Manual" ? "ADD A TRADE" : broker === "JSON" ? "STRUCTURED IMPORT" : "IMPORT TRANSACTIONS", heading = broker === "Manual" ? "Enter a trade manually" : broker === "JSON" ? "Paste structured trade JSON" : "Add trades from your broker", copy = broker === "Manual" ? "Log a completed round-trip trade directly. You can add SPY context and grade it after." : broker === "JSON" ? "Full-precision entry/exit timestamps (to the second) flow straight into the same RS/sector/quality-score analysis as any other import — no CSV round-trip." : "EdgeLog matches opening and closing fills into completed trades. You can review tags, notes, SPY context, and grades after import."; return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget)
    close(); }}><article className="modal"><button className="x" onClick={close}>×</button><p className="eyebrow">{title}</p><h2>{heading}</h2><p className="modal-copy">{copy}</p><div className="broker-toggle wide"><button className={broker === "Robinhood" ? "on" : ""} onClick={() => setBroker("Robinhood")}>Robinhood</button><button className={broker === "thinkorswim" ? "on" : ""} onClick={() => setBroker("thinkorswim")}>thinkorswim</button><button className={broker === "Manual" ? "on" : ""} onClick={() => setBroker("Manual")}>Manual entry</button><button className={broker === "JSON" ? "on" : ""} onClick={() => setBroker("JSON")}>Structured JSON</button></div>{broker === "Manual" ? <ManualEntryForm onAdd={onManualAdd}/> : broker === "JSON" ? <JsonImportForm onAdd={onJsonAdd}/> : <><button className="dropzone" onClick={() => fileRef.current?.click()}><span>⇧</span><b>Choose a CSV file</b><small>or drag and drop it here</small></button><input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => handleFile(e.target.files?.[0])}/><div className="import-help"><b>Expected export</b><p>{broker === "Robinhood" ? "Account → Reports and statements → Account activity. Export CSV with symbol, date, action, quantity, and price." : "Monitor → Account Statement → Trade History. Set the date range, then export the filled-order rows as CSV."}</p></div><small className="security">Your file is processed inside your own app. Broker credentials are never requested.</small></>}</article></div>; }
function JsonImportForm({ onAdd }: { onAdd: (trades: Trade[]) => void }) {
    const [text, setText] = useState(""), [error, setError] = useState("");
    const submit = () => {
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { setError("That isn't valid JSON — check for trailing commas or unquoted keys."); return; }
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        if (!rows.length) { setError("No trades found in that JSON."); return; }
        const out: Trade[] = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i] as Record<string, unknown>, at = `Row ${i + 1}`;
            const symbol = typeof r.symbol === "string" ? r.symbol.trim().toUpperCase() : "";
            if (!symbol) { setError(`${at}: "symbol" is required.`); return; }
            const isOption = r.instrument_type === "option";
            const side: "Long" | "Short" = String(r.side).toLowerCase() === "short" ? "Short" : "Long";
            const entry = typeof r.entry_time === "string" ? r.entry_time : "", exit = typeof r.exit_time === "string" ? r.exit_time : "";
            const entryMs = Date.parse(entry), exitMs = Date.parse(exit);
            if (!entry || Number.isNaN(entryMs)) { setError(`${at}: "entry_time" must be a valid ISO-8601 timestamp.`); return; }
            if (!exit || Number.isNaN(exitMs)) { setError(`${at}: "exit_time" must be a valid ISO-8601 timestamp.`); return; }
            if (exitMs < entryMs) { setError(`${at}: exit_time is before entry_time.`); return; }
            const qty = Number(r.quantity), entryPrice = Number(r.entry_price), exitPrice = Number(r.exit_price);
            if (!(qty > 0)) { setError(`${at}: "quantity" must be greater than 0.`); return; }
            if (!(entryPrice >= 0) || !(exitPrice >= 0)) { setError(`${at}: "entry_price" and "exit_price" must be 0 or greater.`); return; }
            if (isOption && (!r.strike || !r.expiration || !r.option_type)) { setError(`${at}: options require "option_type", "strike", and "expiration".`); return; }
            const mult = isOption ? 100 : 1, pnl = (side === "Long" ? exitPrice - entryPrice : entryPrice - exitPrice) * qty * mult;
            const optionType: "call" | "put" = r.option_type === "put" ? "put" : "call", strike = Number(r.strike), expiration = String(r.expiration || "");
            out.push({ id: `JSON-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`, symbol, side, entry, exit, qty, entryPrice, exitPrice, pnl, spy: 0, rrs: 0, aligned: false, setup: "Imported — review needed", tags: ["Structured import", "Needs review"], notes: "Imported via structured JSON.", grade: "—", ...(isOption ? { assetType: "option" as const, contract: `${symbol} ${strike}${optionType === "call" ? "C" : "P"} ${expiration.slice(5, 7)}/${expiration.slice(8, 10)}`, optionType, strike, expiration, multiplier: 100 } : {}) });
        }
        onAdd(out);
        setText("");
    };
    return <div className="manual-form">{error && <p className="form-error">{error}</p>}<label className="field">PASTE JSON — SINGLE OBJECT OR ARRAY<textarea rows={11} value={text} onChange={e => setText(e.target.value)} placeholder={`{\n  "symbol": "COP",\n  "instrument_type": "option",\n  "option_type": "call",\n  "strike": 141,\n  "expiration": "2026-08-28",\n  "side": "long",\n  "entry_time": "2026-08-20T14:25:41Z",\n  "entry_price": 0.59,\n  "exit_time": "2026-08-20T15:56:13Z",\n  "exit_price": 0.68,\n  "quantity": 1\n}`}/></label><button className="primary save" onClick={submit}>＋ Import trades</button></div>; }
function ManualEntryForm({ onAdd }: { onAdd: (t: Trade) => void }) {
    const [symbol, setSymbol] = useState(""), [side, setSide] = useState<"Long" | "Short">("Long"), [assetType, setAssetType] = useState<"equity" | "option">("equity"), [optionType, setOptionType] = useState<"call" | "put">("call"), [strike, setStrike] = useState(""), [expiration, setExpiration] = useState(""), [entry, setEntry] = useState(""), [exit, setExit] = useState(""), [qty, setQty] = useState(""), [entryPrice, setEntryPrice] = useState(""), [exitPrice, setExitPrice] = useState(""), [error, setError] = useState("");
    const submit = () => {
        const q = Number(qty), ep = Number(entryPrice), xp = Number(exitPrice);
        if (!symbol.trim())
            return setError("Symbol is required.");
        if (!entry || !exit)
            return setError("Entry and exit date/time are required.");
        if (new Date(exit).getTime() < new Date(entry).getTime())
            return setError("Exit must be on or after entry.");
        if (!(q > 0))
            return setError("Quantity must be greater than 0.");
        if (!(ep >= 0) || !(xp >= 0))
            return setError("Entry and exit price must be 0 or greater.");
        if (assetType === "option" && (!strike || !expiration))
            return setError("Strike and expiration are required for options.");
        const mult = assetType === "option" ? 100 : 1, pnl = (side === "Long" ? xp - ep : ep - xp) * q * mult, sym = symbol.trim().toUpperCase();
        const trade: Trade = { id: `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, symbol: sym, side, entry, exit, qty: q, entryPrice: ep, exitPrice: xp, pnl, spy: 0, rrs: 0, aligned: false, setup: "Manual entry", tags: ["Manual"], notes: "", grade: "—", ...(assetType === "option" ? { assetType: "option" as const, contract: `${sym} ${strike}${optionType === "call" ? "C" : "P"} ${expiration.slice(5).replace("-", "/")}`, optionType, strike: Number(strike), expiration, multiplier: 100 } : {}) };
        onAdd(trade);
    };
    return <div className="manual-form">{error && <p className="form-error">{error}</p>}<div className="form-row"><label>Symbol<input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL"/></label><label>Side<select value={side} onChange={e => setSide(e.target.value as "Long" | "Short")}><option>Long</option><option>Short</option></select></label><label>Asset type<select value={assetType} onChange={e => setAssetType(e.target.value as "equity" | "option")}><option value="equity">Equity</option><option value="option">Option</option></select></label></div>{assetType === "option" && <div className="form-row"><label>Option type<select value={optionType} onChange={e => setOptionType(e.target.value as "call" | "put")}><option value="call">Call</option><option value="put">Put</option></select></label><label>Strike<input type="number" value={strike} onChange={e => setStrike(e.target.value)} placeholder="230"/></label><label>Expiration<input type="date" value={expiration} onChange={e => setExpiration(e.target.value)}/></label></div>}<div className="form-row"><label>Entry date/time<input type="datetime-local" value={entry} onChange={e => setEntry(e.target.value)}/></label><label>Exit date/time<input type="datetime-local" value={exit} onChange={e => setExit(e.target.value)}/></label></div><div className="form-row"><label>Quantity ({assetType === "option" ? "contracts" : "shares"})<input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="100"/></label><label>Entry {assetType === "option" ? "premium" : "price"}<input type="number" step="0.01" value={entryPrice} onChange={e => setEntryPrice(e.target.value)} placeholder="0.00"/></label><label>Exit {assetType === "option" ? "premium" : "price"}<input type="number" step="0.01" value={exitPrice} onChange={e => setExitPrice(e.target.value)} placeholder="0.00"/></label></div><button className="primary save" onClick={submit}>＋ Add trade</button></div>; }
function TradeDrawer({ trade, close, save, onDelete }: {
    trade: Trade;
    close: () => void;
    save: (t: Trade) => void;
    onDelete: (id: string) => void;
}) { const [draft, setDraft] = useState(trade), [newTag, setNewTag] = useState(""), unit=trade.assetType==="option"?"contract":"share"; const remove = () => { if (confirm(`Delete this ${trade.symbol} trade? This can't be undone.`))
    onDelete(trade.id); }; const addTag = () => { const x = newTag.trim(); if (x && !draft.tags.includes(x))
    setDraft({ ...draft, tags: [...draft.tags, x] }); setNewTag(""); }; return <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget)
    close(); }}><aside className="drawer"><div className="drawer-head"><div><p>{trade.id}</p><h2>{trade.symbol} <span>{trade.side}</span></h2><small>{trade.contract?`${trade.contract} · `:""}{day(trade.entry)} · {clock(trade.entry)}–{clock(trade.exit)}</small></div><button onClick={close}>×</button></div><div className={`trade-result ${trade.pnl >= 0 ? "win" : "loss"}`}><span>REALIZED P&amp;L</span><strong>{money(trade.pnl)}</strong><small>{trade.qty} {unit}{trade.qty===1?"":"s"} · {money(trade.pnl / trade.qty)} / {unit}</small></div><section className="execution"><div><small>{trade.assetType==="option"?"ENTRY PREMIUM":"ENTRY"}</small><b>{money(trade.entryPrice)}</b></div><span>→</span><div><small>{trade.assetType==="option"?"EXIT PREMIUM":"EXIT"}</small><b>{money(trade.exitPrice)}</b></div><div><small>{trade.side==="Short"?"RW VS SPY":"RS VS SPY"}</small><b className={trade.rrs >= 0 ? "pos" : "neg"}>{trade.rrs > 0 ? "+" : ""}{trade.rrs.toFixed(1)}</b></div></section><section className="context-card"><p>MARKET CONTEXT</p><div><span>SPY move at entry <b>{trade.spy > 0 ? "+" : ""}{trade.spy.toFixed(2)}%</b></span><span>Direction <b className={trade.aligned ? "pos" : "neg"}>{trade.aligned ? "Aligned" : "Against"}</b></span></div>{trade.analysis?.sectorEtf && <div><span>Sector{trade.analysis.sectorLabel ? `: ${trade.analysis.sectorLabel}` : ""} ({trade.analysis.sectorEtf}) <b className={(trade.analysis.metrics.stockSectorRrs ?? 0) >= 0 ? "pos" : "neg"}>{trade.analysis.metrics.stockSectorRrs == null ? "—" : `${trade.analysis.metrics.stockSectorRrs >= 0 ? "+" : ""}${trade.analysis.metrics.stockSectorRrs.toFixed(2)}`}</b></span></div>}<label><input type="checkbox" checked={draft.aligned} onChange={e => setDraft({ ...draft, aligned: e.target.checked })}/> Trade direction aligned with SPY</label></section><label className="field">SETUP<input value={draft.setup} onChange={e => setDraft({ ...draft, setup: e.target.value })}/></label><label className="field">PROCESS GRADE<select value={draft.grade} onChange={e => setDraft({ ...draft, grade: e.target.value, tags: draft.tags.filter(t => t !== "Auto process grade") })}>{["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "—"].map(x => <option key={x}>{x}</option>)}</select><small>Auto-suggested from verified RDT entry criteria, not P&amp;L. A+ requires manual review.</small>{trade.analysis && <div className="gate-note"><p className="rec-text">{trade.analysis.recommendation}</p><small className="gate-summary">{gateSummary(trade.analysis)}</small></div>}</label><div className="field"><span>TAGS</span><div className="tag-editor">{draft.tags.map(x => <button key={x} onClick={() => setDraft({ ...draft, tags: draft.tags.filter(t => t !== x) })}>{x} ×</button>)}</div><div className="tag-add"><input value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => { if (e.key === "Enter")
    addTag(); }} placeholder="Add tag"/><button onClick={addTag}>＋</button></div></div><label className="field">JOURNAL NOTES<textarea rows={5} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })}/></label><div className="drawer-actions"><button className="primary save" onClick={() => save(draft)}>Save journal entry</button><button className="danger" onClick={remove}>Delete</button></div></aside></div>; }
