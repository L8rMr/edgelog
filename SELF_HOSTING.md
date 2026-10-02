# EdgeLog self-hosting

## Docker Compose

1. Install Docker Desktop or Docker Engine with Compose.
2. From this folder, run `docker compose up -d --build`.
3. Open `http://localhost:3000`.

The compose file exposes port 3000 and reserves a persistent `edgelog-data` volume. Put the app behind Caddy, Traefik, or Nginx with HTTPS before exposing it beyond your private network.

## Actual RDT market analysis

The floating **Analyze actual market data** button enriches every completed trade using historical 5-minute and daily bars available at its entry timestamp. It computes ATR-normalized RRS/RW, SPY direction and VWAP alignment, 3/8 EMA timing, time-of-day relative volume, daily-chart quality, sector stacking when a sector ETF is known, and void to the nearest daily pivot.

By default the app uses Yahoo's public chart feed as a best-effort, no-key fallback for recent history. For a supported market-data API, copy `.env.example` to `.env`, add a Massive API key, and restart Docker Compose. Massive is preferred automatically when `MASSIVE_API_KEY` is set. Historical depth depends on the provider plan.

### External bar feed (e.g. Robinhood)

`POST /api/market-bars` with `{ symbol, interval: "5minute"|"day", bars: [{ t, o, h, l, c, v }] }` (`t` in epoch ms) upserts bars into a local cache (`market-bars.json` inside the data volume). `createMarketLoader` checks this cache before Massive/Yahoo, so any bars pushed here take priority for entry-time analysis. `GET /api/market-bars` lists cached keys and counts for debugging. There's no auth on this route — it's meant to be called only from inside the trusted network the container runs on.

The engine never converts unavailable data into a pass. Missing bars, unknown sector mappings, catalysts, and discretionary chart geometry are shown as **unverified** and reduce the completeness score.

## Updating

Pull or copy the updated source, then run `docker compose up -d --build` again. The named data volume is retained.

## Imports

Use Robinhood account-activity CSV or thinkorswim filled-order CSV. EdgeLog pairs opening and closing fills by symbol using average cost, then sends each imported trade to review for tags, notes, RDT context, and process grading.

Direct broker synchronization is intentionally an adapter boundary. Enable it only with an officially supported broker API and store credentials as container secrets, never in the browser.
