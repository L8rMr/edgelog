const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
// Exercise the actual TypeScript handlers without starting or mutating the live app.
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, filename) => {
    const source = require("node:fs").readFileSync(filename, "utf8");
    module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
};
const { GET, PUT } = require("../app/api/reviews/route.ts");
const barsApi = require("../app/api/market-bars/route.ts");
const { blankReview, cohortSummary, checkSummary } = require("../lib/journal.ts");
let directory, previous;
before(async () => { previous = process.env.EDGELOG_DATA_DIR; directory = await fs.mkdtemp(path.join(os.tmpdir(), "edgelog-review-test-")); process.env.EDGELOG_DATA_DIR = directory; });
after(async () => { if (previous === undefined) delete process.env.EDGELOG_DATA_DIR; else process.env.EDGELOG_DATA_DIR = previous; await fs.rm(directory, { recursive: true, force: true }); });
const request = (body) => new Request("http://localhost/api/reviews", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = id => GET(new Request("http://localhost/api/reviews" + (id ? `?tradeId=${encodeURIComponent(id)}` : "")));

test("new trades require human review; loading does not create a file", async () => {
    const response = await get("new-trade");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).review, blankReview("new-trade"));
    assert.deepEqual((await (await get()).json()).reviews, []);
});
test("review notes, source, flag and screenshots round-trip independently of imported trades", async () => {
    const ledger = JSON.stringify([{ id: "T1", notes: "Original imported notes", pnl: 14 }]);
    await fs.writeFile(path.join(directory, "trades.json"), ledger);
    const draft = { ...blankReview("T1"), status: "reviewed", flagged: true, thesis: "Original setup", thesisSource: "entry-notes", reflection: "Exited on plan", repeat: "Wait for confirmation", avoid: "Chasing", process: "followed", screenshots: [{ id: "image-1", name: "chart.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }] };
    const response = await PUT(request(draft)); assert.equal(response.status, 200);
    const saved = (await response.json()).review;
    assert.equal(saved.revision, 1); assert.ok(saved.updatedAt);
    assert.deepEqual((await (await get("T1")).json()).review, saved);
    const summary = (await (await get()).json()).reviews[0];
    assert.equal(summary.status, "reviewed"); assert.equal(summary.screenshotCount, 1); assert.equal(summary.flagged, true); assert.equal(summary.screenshots, undefined);
    assert.equal(await fs.readFile(path.join(directory, "trades.json"), "utf8"), ledger);
    const reopened = await PUT(request({ ...saved, status: "pending" }));
    assert.equal((await reopened.json()).review.status, "pending");
});
test("stale or simultaneous saves cannot silently replace newer notes", async () => {
    const draft = blankReview("concurrent");
    const responses = await Promise.all([PUT(request({ ...draft, reflection: "first" })), PUT(request({ ...draft, reflection: "second" }))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal((await (await get("concurrent")).json()).review.revision, 1);
    assert.equal((await PUT(request(draft))).status, 409);
});
test("review identifiers cannot escape the data directory", async () => {
    const id = "../../outside";
    assert.equal((await PUT(request({ ...blankReview(id), reflection: "safe path" }))).status, 200);
    assert.equal((await (await get(id)).json()).review.reflection, "safe path");
    const files = await fs.readdir(path.join(directory, "reviews"));
    assert.ok(files.every(name => /^[a-f0-9]{64}\.json$/.test(name)));
});
test("rejects invalid states, oversized notes, malformed JSON and unsupported image content", async () => {
    assert.equal((await PUT(request({ ...blankReview("bad"), status: "automatic" }))).status, 400);
    assert.equal((await PUT(request({ ...blankReview("bad"), reflection: "x".repeat(10001) }))).status, 400);
    assert.equal((await PUT(request({ ...blankReview("bad"), screenshots: [{ id: "x", name: "bad.svg", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }] }))).status, 400);
    assert.equal((await PUT(new Request("http://localhost", { method: "PUT", body: "{" }))).status, 400);
    assert.equal((await PUT(new Request("http://localhost", { method: "PUT", body: "x".repeat(3000001) }))).status, 413);
});
test("storage failures return errors instead of an empty review or false save success", async () => {
    await fs.writeFile(path.join(directory, "blocked"), "not a directory");
    process.env.EDGELOG_DATA_DIR = path.join(directory, "blocked");
    try {
        assert.equal((await get("test")).status, 500);
        assert.equal((await PUT(request(blankReview("test")))).status, 500);
    } finally { process.env.EDGELOG_DATA_DIR = directory; }
});
test("evidence samples exclude demo, missing and manually asserted alignment", () => {
    const row = (pnl, status, demo = false) => ({ pnl, demo, aligned: true, analysis: status ? { checks: [{ key: "market", status }] } : undefined });
    const trades = [row(20, "pass"), row(-5, "pass"), row(0, "pass"), row(-10, "fail"), row(99, "unverified"), row(100, null), row(100, "pass", true)];
    const cohort = cohortSummary(trades, "market");
    assert.equal(cohort.count, 3); assert.equal(cohort.wins, 1); assert.ok(Math.abs(cohort.winRate - 100 / 3) < 1e-10);
    assert.deepEqual(checkSummary(trades, "market"), { count: 4, passes: 3, rate: 75 });
    assert.deepEqual(cohortSummary([], "market"), { count: 0, wins: 0, winRate: null });
});
test("chart endpoint clips cached bars and retains the summary API", async () => {
    const candle = t => ({ t, o: 10, h: 12, l: 9, c: 11, v: 50 });
    await fs.writeFile(path.join(directory, "market-bars.json"), JSON.stringify({ "SPY:5minute": [candle(300000), candle(600000), candle(900000)] }));
    const response = await barsApi.GET(new Request("http://localhost/api/market-bars?symbol=SPY&from=600000&to=900000"));
    assert.deepEqual((await response.json()).bars.map(b => b.t), [600000, 900000]);
    assert.equal((await (await barsApi.GET(new Request("http://localhost/api/market-bars"))).json()).cached["SPY:5minute"].count, 3);
    assert.equal((await barsApi.GET(new Request("http://localhost/api/market-bars?symbol=SPY&from=10&to=0"))).status, 400);
    assert.equal((await barsApi.GET(new Request("http://localhost/api/market-bars?symbol=SPY&from=0&to=999999999999"))).status, 400);
    const missing = await barsApi.GET(new Request("http://localhost/api/market-bars?symbol=MISSING&from=0&to=999999"));
    assert.deepEqual((await missing.json()).bars, []);
});
test("queue renders human review status, excludes demo rows and keeps trades actionable", () => {
    const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
    const { ReviewQueue, ReviewShortcut } = require("../app/trade-review.tsx");
    const trade = { id: "QUEUE", symbol: "AAPL", side: "Long", qty: 1, setup: "Test setup", pnl: 5, entry: "2026-09-04T14:00:00Z", exit: "2026-09-04T15:00:00Z" };
    const html = renderToStaticMarkup(React.createElement(ReviewQueue, { trades: [trade, { ...trade, id: "demo", symbol: "DEMO", demo: true }], reviews: {}, onSelect() {} }));
    assert.match(html, /AAPL/); assert.doesNotMatch(html, /DEMO/); assert.match(html, /To review/); assert.match(html, /Missing market evidence/); assert.match(html, /<button class="queue-trade"/);
    const shortcut = renderToStaticMarkup(React.createElement(ReviewShortcut, { trades: [trade], reviews: { QUEUE: { status: "reviewed" } }, open() {} }));
    assert.match(shortcut, /1 of 1 trades reviewed/);
});
test("at-entry charts exclude incomplete and later candles; option charts use time markers only", () => {
    const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
    const { PriceChart } = require("../app/trade-review.tsx");
    const props = { symbol: "TEST", bars: [0, 300000, 600000].map(t => ({ t, o: 10, h: 12, l: 9, c: 11, v: 1 })), from: 0, to: 900000, entry: 450000, exit: 750000, hover: null, setHover() {} };
    const atEntry = renderToStaticMarkup(React.createElement(PriceChart, { ...props, entryOnly: true }));
    assert.equal((atEntry.match(/class="candle-up"/g) || []).length, 1);
    assert.doesNotMatch(atEntry, /class="exit-marker"/);
    const fullTrade = renderToStaticMarkup(React.createElement(PriceChart, { ...props, entryOnly: false }));
    assert.equal((fullTrade.match(/class="candle-up"/g) || []).length, 3);
    assert.match(fullTrade, /class="exit-marker"/); assert.doesNotMatch(fullTrade, /<circle/);
    const equity = renderToStaticMarkup(React.createElement(PriceChart, { ...props, entryOnly: false, fills: { entry: 10, exit: 11 } }));
    assert.equal((equity.match(/<circle/g) || []).length, 2);
});
