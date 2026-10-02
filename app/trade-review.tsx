"use client";

import { useEffect, useRef, useState } from "react";
import { blankReview, summarizeReview } from "../lib/journal";
import type { Trade, Review, ReviewSummary, ReviewImage } from "../lib/journal";
import type { Bar } from "../lib/rdt";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const date = (s: string | number) => new Date(s).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const time = (n: number) => new Date(n).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
type ReviewMap = Record<string, ReviewSummary>;

export function ReviewShortcut({ trades, reviews, open }: { trades: Trade[]; reviews: ReviewMap; open: () => void }) {
    const actual = trades.filter(t => !t.demo), pending = actual.filter(t => reviews[t.id]?.status !== "reviewed").length;
    return <section className="review-shortcut"><div><span className="review-kicker">YOUR REVIEW QUEUE</span><h2>{pending ? `${pending} trade${pending === 1 ? "" : "s"} to reflect on` : "Your reviews are up to date"}</h2><p>{actual.length - pending} of {actual.length} trades reviewed in this timeframe · Automatic analysis does not mark a trade reviewed.</p></div><button onClick={open}>Open review queue <span aria-hidden="true">→</span></button></section>;
}

export function ReviewQueue({ trades, reviews, onSelect }: { trades: Trade[]; reviews: ReviewMap; onSelect: (trade: Trade) => void }) {
    const [filter, setFilter] = useState("pending"), [query, setQuery] = useState("");
    const actual = trades.filter(t => !t.demo), counts = {
        pending: actual.filter(t => reviews[t.id]?.status !== "reviewed").length,
        flagged: actual.filter(t => reviews[t.id]?.flagged).length,
        reviewed: actual.filter(t => reviews[t.id]?.status === "reviewed").length,
        all: actual.length,
    };
    const rows = actual.filter(t => (filter === "all" || (filter === "flagged" ? reviews[t.id]?.flagged : filter === "reviewed" ? reviews[t.id]?.status === "reviewed" : reviews[t.id]?.status !== "reviewed")) && `${t.symbol} ${t.setup}`.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => Number(!!reviews[b.id]?.flagged) - Number(!!reviews[a.id]?.flagged) || Date.parse(b.exit) - Date.parse(a.exit));
    return <section className="review-queue"><p className="review-intro">Review the evidence, record what you learned, and choose what to repeat. Flagged trades appear first.</p><div className="queue-toolbar"><div className="queue-filters" aria-label="Review status">{(["pending", "flagged", "reviewed", "all"] as const).map(key => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{key === "pending" ? "To review" : key === "all" ? "All trades" : key[0].toUpperCase() + key.slice(1)} <b>{counts[key]}</b></button>)}</div><input aria-label="Search review queue" placeholder="Search ticker or setup" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="queue-list">{rows.map(trade => {
        const review = reviews[trade.id];
        return <button className="queue-trade" key={trade.id} onClick={() => onSelect(trade)}><div className="queue-symbol"><strong>{trade.symbol}</strong><span>{trade.side} · {trade.assetType === "option" ? trade.contract || "Option" : "Equity"}</span></div><div className="queue-description"><b>{trade.setup}</b><span>{date(trade.entry)} ET</span></div><div className="queue-badges">{review?.flagged && <span className="evidence-chip caution">Flagged</span>}<span className={`evidence-chip ${review?.status === "reviewed" ? "manual" : ""}`}>{review?.status === "reviewed" ? "Reviewed" : "To review"}</span><small>{trade.analysis ? "Computed evidence available" : "Missing market evidence"}</small></div><strong className={trade.pnl < 0 ? "neg" : "pos"}>{money(trade.pnl)}</strong><span aria-hidden="true">↗</span></button>;
    })}</div>{!rows.length && <div className="review-empty"><h2>{filter === "pending" && !query ? "Nothing waiting for review" : "No matching trades"}</h2><p>{!actual.length ? "Import completed trades or widen the timeframe to begin." : "Try another status, search, or timeframe."}</p></div>}</section>;
}

export function PriceChart({ symbol, bars, entry, exit, from, to, entryOnly, hover, setHover, fills }: {
    symbol: string; bars: Bar[]; entry: number; exit: number; from: number; to: number;
    entryOnly: boolean; hover: number | null; setHover: (t: number | null) => void;
    fills?: { entry: number; exit: number };
}) {
    const shown = bars.filter(b => !entryOnly || b.t + 300000 <= entry);
    const chartTo = entryOnly ? entry : to, span = Math.max(chartTo - from, 300000);
    const x = (t: number) => 56 + (t - from) / span * 628;
    const prices = shown.flatMap(b => [b.l, b.h]);
    if (fills && shown.length) { prices.push(fills.entry); if (!entryOnly) prices.push(fills.exit); }
    const low = Math.min(...prices), high = Math.max(...prices), spread = Math.max(high - low, Math.abs(high) * .001, .01);
    const y = (price: number) => 46 + (high + spread * .1 - price) / (spread * 1.2) * 138;
    const selected = hover === null ? null : shown.reduce<Bar | null>((best, bar) => !best || Math.abs(bar.t - hover) < Math.abs(best.t - hover) ? bar : best, null);
    const width = Math.max(1, Math.min(8, 628 * 300000 / span * .65));
    return <section className="review-chart"><div className="review-chart-title"><h3>{symbol}</h3><span>5-minute candles · ET</span></div>{shown.length ? <><svg viewBox="0 0 720 224" role="img" aria-label={`${symbol} price chart with entry${entryOnly ? "" : " and exit"} time markers`} onPointerMove={e => { const box = e.currentTarget.getBoundingClientRect(); setHover(from + Math.max(0, Math.min(1, ((e.clientX - box.left) / box.width * 720 - 56) / 628)) * span); }} onPointerLeave={() => setHover(null)}>
        {[0, .5, 1].map(f => { const price = low + (high - low) * f; return <g key={f}><line x1="56" x2="684" y1={y(price)} y2={y(price)} className="review-chart-grid"/><text x="48" y={y(price) + 4} textAnchor="end">{price.toFixed(2)}</text></g>; })}
        {shown.map(bar => <g key={bar.t} className={bar.c >= bar.o ? "candle-up" : "candle-down"}><line x1={x(bar.t)} x2={x(bar.t)} y1={y(bar.h)} y2={y(bar.l)}/><rect x={x(bar.t) - width / 2} y={y(Math.max(bar.o, bar.c))} width={width} height={Math.max(1, Math.abs(y(bar.o) - y(bar.c)))}/></g>)}
        {[{ t: entry, label: "ENTRY", price: fills?.entry }, ...(!entryOnly ? [{ t: exit, label: "EXIT", price: fills?.exit }] : [])].filter(m => m.t >= from && m.t <= chartTo).map(marker => <g key={marker.label} className={marker.label === "ENTRY" ? "entry-marker" : "exit-marker"}><line x1={x(marker.t)} x2={x(marker.t)} y1="34" y2="194"/><text x={x(marker.t)} y={marker.label === "ENTRY" ? 15 : 29} textAnchor={x(marker.t) > 620 ? "end" : "start"}>{marker.label} {time(marker.t)}</text>{marker.price !== undefined && <circle cx={x(marker.t)} cy={y(marker.price)} r="4"/>}</g>)}
        {[0, .33, .66, 1].map(f => <text key={f} x={56 + f * 628} y="216" textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}>{time(from + f * span)}</text>)}
        {selected && <line x1={x(selected.t)} x2={x(selected.t)} y1="36" y2="194" className="review-crosshair"/>}
    </svg><div className="candle-readout" aria-live="polite">{selected ? `${date(selected.t)} ET · O ${selected.o.toFixed(2)} / H ${selected.h.toFixed(2)} / L ${selected.l.toFixed(2)} / C ${selected.c.toFixed(2)}` : `${shown.length} cached candles · Hover or use the candle selector below`}</div><input className="candle-selector" aria-label={`Inspect ${symbol} candle`} type="range" min={0} max={shown.length - 1} defaultValue={0} onChange={e => setHover(shown[Number(e.target.value)].t)}/></> : <div className="chart-missing">No cached {symbol} candles in this window. Attach a screenshot below to retain your chart context.</div>}</section>;
}

export function TradeReview({ trade, close, onSaved, onEdit }: { trade: Trade; close: () => void; onSaved: (review: ReviewSummary) => void; onEdit: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null), fileInput = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState<Review>(blankReview(trade.id)), [baseline, setBaseline] = useState(""), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [attaching, setAttaching] = useState(false), [error, setError] = useState(""), [savedMessage, setSavedMessage] = useState("");
    const [bars, setBars] = useState<{ stock: Bar[]; spy: Bar[] }>({ stock: [], spy: [] }), [chartLoading, setChartLoading] = useState(true), [chartError, setChartError] = useState(""), [entryOnly, setEntryOnly] = useState(false), [hover, setHover] = useState<number | null>(null), [retry, setRetry] = useState(0);
    const entry = Date.parse(trade.entry), exit = Date.parse(trade.exit), from = entry - 3600000, to = Math.min(exit + 3600000, from + 31 * 86400000);
    const dirty = !!baseline && JSON.stringify(draft) !== baseline;
    const update = (patch: Partial<Review>) => { setDraft(d => ({ ...d, ...patch })); setSavedMessage(""); };
    const leave = (action: () => void) => { if (!saving && !attaching && (!dirty || confirm("Discard unsaved review changes?"))) action(); };

    useEffect(() => { const node = dialog.current; node?.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { node?.close(); document.body.style.overflow = previous; }; }, []);
    useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError("");
        fetch(`/api/reviews?tradeId=${encodeURIComponent(trade.id)}`, { signal: controller.signal }).then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error); return payload.review as Review; }).then(review => { setDraft(review); setBaseline(JSON.stringify(review)); setLoading(false); }).catch(e => { if (e.name !== "AbortError") { setError(e.message || "Review could not be loaded."); setLoading(false); } });
        return () => controller.abort();
    }, [trade.id, retry]);
    useEffect(() => {
        const controller = new AbortController();
        const load = async (symbol: string) => { const response = await fetch(`/api/market-bars?${new URLSearchParams({ symbol, interval: "5minute", from: String(from), to: String(to) })}`, { signal: controller.signal }); if (!response.ok) throw new Error("Cached charts could not be loaded. Your review is still available."); return (await response.json()).bars as Bar[]; };
        Promise.all([load(trade.symbol), trade.symbol === "SPY" ? Promise.resolve([]) : load("SPY")]).then(([stock, spy]) => { setBars({ stock, spy: trade.symbol === "SPY" ? stock : spy }); setChartLoading(false); }).catch(e => { if (e.name !== "AbortError") { setChartError(e.message); setChartLoading(false); } });
        return () => controller.abort();
    }, [trade.symbol, from, to]);

    const save = async (complete: boolean) => {
        setSaving(true); setError(""); setSavedMessage("");
        try {
            const response = await fetch("/api/reviews", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, status: complete ? "reviewed" : draft.status }) });
            const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Review was not saved.");
            setDraft(payload.review); setBaseline(JSON.stringify(payload.review)); onSaved(summarizeReview(payload.review));
            setSavedMessage(complete ? "Saved and marked reviewed." : "Review saved.");
        } catch (e) { setError(e instanceof Error ? e.message : "Review was not saved. Try again."); }
        finally { setSaving(false); }
    };
    const attach = async (files: FileList | null) => {
        if (!files?.length) return;
        setError("");
        if (files.length + draft.screenshots.length > 2) { setError("Attach up to two screenshots per trade."); return; }
        setAttaching(true);
        try {
            const images = await Promise.all(Array.from(files).map(file => {
                if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 1_000_000) throw new Error("Use PNG, JPEG or WebP screenshots under 1 MB each.");
                return new Promise<ReviewImage>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name.slice(0, 200), dataUrl: String(reader.result) }); reader.onerror = () => reject(new Error("Screenshot could not be read.")); reader.readAsDataURL(file); });
            }));
            setDraft(previous => ({ ...previous, screenshots: [...previous.screenshots, ...images] })); setSavedMessage("");
        } catch (e) { setError(e instanceof Error ? e.message : "Screenshot could not be read."); }
        finally { setAttaching(false); if (fileInput.current) fileInput.current.value = ""; }
    };
    const analysis = trade.analysis, market = analysis?.checks.find(c => c.key === "market");
    return <dialog ref={dialog} className="trade-review-dialog" aria-labelledby="trade-review-title" onCancel={e => { e.preventDefault(); leave(close); }}>
        <div className="review-header"><div><p className="review-kicker">TRADE REVIEW <span>· {date(trade.entry)} ET</span></p><h2 id="trade-review-title">{trade.symbol} <span>{trade.side} · {trade.assetType === "option" ? trade.contract || "Option" : `${trade.qty} shares`}</span></h2></div><div className="review-header-actions"><button disabled={saving || attaching} onClick={() => leave(onEdit)}>Edit trade details</button><button className="review-close" aria-label="Close trade review" disabled={saving || attaching} onClick={() => leave(close)}>×</button></div></div>
        <div className="review-scroll"><div className="review-metrics"><div><span>Realized P&amp;L</span><strong className={trade.pnl < 0 ? "neg" : "pos"}>{money(trade.pnl)}</strong></div><div><span>{trade.assetType === "option" ? "Entry premium" : "Entry price"}</span><strong>{money(trade.entryPrice)}</strong><small>{date(trade.entry)} ET</small></div><div><span>{trade.assetType === "option" ? "Exit premium" : "Exit price"}</span><strong>{money(trade.exitPrice)}</strong><small>{date(trade.exit)} ET</small></div><div><span>Time in trade</span><strong>{Math.max(0, Math.round((exit - entry) / 60000)).toLocaleString()} min</strong><small>{trade.qty} {trade.assetType === "option" ? "contracts" : "shares"}</small></div></div>
        <div className="review-columns"><div className="review-evidence"><section className="review-section"><div className="review-section-heading"><h3>Chart context</h3><div className="chart-mode"><button aria-pressed={!entryOnly} onClick={() => { setEntryOnly(false); setHover(null); }}>Full trade</button><button aria-pressed={entryOnly} onClick={() => { setEntryOnly(true); setHover(null); }}>At entry</button></div></div><p className="review-help">{entryOnly ? "Only candles completed before entry are shown." : "Retrospective view includes candles after entry."} {trade.assetType === "option" ? "Charts show the underlying stock; markers show execution times, not option prices." : "Markers show execution times and fill prices."}</p>{to < exit && <p className="review-help">Chart window is limited to the first 31 days; the exit is outside this window.</p>}{chartLoading ? <p role="status">Loading cached charts…</p> : chartError ? <p role="alert" className="review-error">{chartError}</p> : <><PriceChart symbol={trade.symbol} bars={bars.stock} entry={entry} exit={exit} from={from} to={to} entryOnly={entryOnly} hover={hover} setHover={setHover} fills={trade.assetType === "option" ? undefined : { entry: trade.entryPrice, exit: trade.exitPrice }}/>{trade.symbol !== "SPY" && <PriceChart symbol="SPY" bars={bars.spy} entry={entry} exit={exit} from={from} to={to} entryOnly={entryOnly} hover={hover} setHover={setHover}/>}<p className="review-help">Source: imported bar cache. Blank intervals have no cached candles; prices are not interpolated.</p></>}</section>
        <section className="review-section"><div className="review-section-heading"><h3>Evidence at entry</h3><span className="evidence-chip">{analysis ? "Computed" : "Missing evidence"}</span></div>{analysis ? <><div className="entry-evidence-summary"><span>SPY alignment <b>{market?.status === "pass" ? "Pass" : market?.status === "fail" ? "Failed / unclear" : "Unverified"}</b></span><span>Process score <b>{analysis.score ?? "—"} / 100</b></span><span>Verified checks <b>{analysis.checks.filter(c => c.status !== "unverified").length} / {analysis.checks.length}</b></span></div><p className="review-help">{analysis.provider} · Computed {date(analysis.analyzedAt)} ET. These checks are separate from your manual assessment.</p><div className="evidence-checks">{analysis.checks.map(check => <details key={check.key}><summary><span className={`check-state ${check.status}`}>{check.status === "unverified" ? "Missing" : check.status === "pass" ? "Pass" : "Fail"}</span><span>{check.label}</span><b>{check.value}</b></summary><p>{check.evidence}</p></details>)}</div></> : <p className="review-help">No computed evidence is available for this trade. Missing data is not a pass or a failure.</p>}</section>
        {trade.notes && <section className="review-section"><h3>Existing journal notes</h3><p className="review-preserved-notes">{trade.notes}</p><p className="review-help">Preserved from the trade record. Their timing relative to entry is not verified.</p></section>}</div>
        <div className="review-writing"><fieldset disabled={loading || saving || attaching || !baseline}><section className="review-section"><div className="review-section-heading"><h3>Your review</h3><span className="evidence-chip manual">Manual</span></div><div className="review-state-row"><span className="evidence-chip">{draft.status === "reviewed" ? "Reviewed" : "To review"}</span><label><input type="checkbox" checked={draft.flagged} onChange={e => update({ flagged: e.target.checked })}/> Flag for follow-up</label></div>{draft.status === "reviewed" && <button className="review-text-button" onClick={() => update({ status: "pending" })}>Move back to review queue</button>}<label className="review-field">Entry thesis<textarea rows={3} maxLength={10000} value={draft.thesis} onChange={e => update({ thesis: e.target.value })} placeholder="What did you expect, and what would invalidate the trade?"/></label><label className="review-field">Thesis source<select value={draft.thesisSource} onChange={e => update({ thesisSource: e.target.value as Review["thesisSource"] })}><option value="reconstructed">Reconstructed during review</option><option value="entry-notes">Copied from notes made before entry</option></select><small>Source is self-reported. This field is saved during your review, not timestamped as a pre-trade plan.</small></label><label className="review-field">Did you follow your process?<select value={draft.process} onChange={e => update({ process: e.target.value as Review["process"] })}><option value="unrated">Not assessed</option><option value="followed">Followed my process</option><option value="broke">Broke my process</option></select></label><label className="review-field">What happened?<textarea rows={4} maxLength={10000} value={draft.reflection} onChange={e => update({ reflection: e.target.value })} placeholder="Compare the execution with your plan. What did you learn?"/></label><label className="review-field">Repeat next time<textarea rows={2} maxLength={10000} value={draft.repeat} onChange={e => update({ repeat: e.target.value })} placeholder="One behavior worth repeating"/></label><label className="review-field">Change next time<textarea rows={2} maxLength={10000} value={draft.avoid} onChange={e => update({ avoid: e.target.value })} placeholder="One specific adjustment"/></label></section>
        <section className="review-section"><div className="review-section-heading"><h3>Screenshots</h3><button disabled={draft.screenshots.length >= 2} onClick={() => fileInput.current?.click()}>＋ Attach</button></div><input hidden ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => void attach(e.target.files)}/><p className="review-help">Up to two images, 1 MB each. Stored on your local server when you save.</p>{draft.screenshots.map(image => <figure className="review-screenshot" key={image.id}><a href={image.dataUrl} download={image.name}><img src={image.dataUrl} alt={image.name}/></a><figcaption><span>{image.name}</span><button onClick={() => update({ screenshots: draft.screenshots.filter(i => i.id !== image.id) })}>Remove</button></figcaption></figure>)}</section></fieldset></div></div></div>
        <footer className="review-footer"><div aria-live="polite">{loading ? "Loading saved review…" : error ? <span className="review-error" role="alert">{error} {!baseline && <button onClick={() => setRetry(n => n + 1)}>Retry</button>}</span> : savedMessage || (dirty ? "Unsaved changes" : draft.updatedAt ? `Last saved ${date(draft.updatedAt)} ET` : "No saved review yet")}</div><div><button disabled={loading || saving || attaching || !baseline || trade.demo} onClick={() => void save(false)}>{saving ? "Saving…" : "Save review"}</button><button className="primary" disabled={loading || saving || attaching || !baseline || trade.demo} onClick={() => void save(true)}>Save &amp; mark reviewed</button></div>{trade.demo && <small>Demo trade · Import a real trade to save a review.</small>}</footer>
    </dialog>;
}
