# CLEAR API — Setup & Local Testing

**Docs:** https://api.clearinitiative.io/docs#guide  
**Endpoint:** `POST https://api.clearinitiative.io/graphql`  
**Product tie-in:** NRC Clear · Crisis Intelligence (SYNTROFI map)

---

## What CLEAR is

CLEAR is a **humanitarian intelligence GraphQL API**. Data is organized as a **five-tier graph** — raw observations are grouped upward into things analysts can act on:

| Tier | What it is | SYNTROFI use |
|------|------------|--------------|
| **Location** | Country → state → district → point (PostGIS hierarchy) | Map focus, AOI presets, “what’s happening in Afghanistan” |
| **Signal** | One raw observation (ACLED, GDACS, Dataminr, manual field report) | Live crisis points, source evidence |
| **Event** | Cluster of related signals, typed + geolocated | Crisis mesh units, severity coloring |
| **Alert** | Published advisory escalated from a severe event | Analyst queue, urgency pulses |
| **Crisis** | User-curated aggregation + LLM summary, scenarios, needs analysis | Analyst card (headline, aid needs, next action) |

**Key idea:** almost everything is **geolocated**. The most useful entry queries are `…ByLocation` — pass one country id and you get all signals/events/alerts anywhere inside that country (including child districts).

---

## Authentication

### API key (what we use locally)

Server-to-server only. Send as a Bearer token:

```http
Authorization: Bearer sk_...
Content-Type: application/json
```

**Never** put `CLEAR_API_KEY` in frontend code or commit it. Vite only exposes variables prefixed with `VITE_` — we intentionally use `CLEAR_API_KEY` (no prefix) so it stays server/script-only.

### Session cookies (browser apps)

For logged-in web apps: sign in via REST auth, then call `/graphql` with cookies. SYNTROFI will use a **backend proxy** in production so the key never hits the browser.

---

## Local setup

### 1. Add your key

Create `.env.local` (gitignored):

```bash
CLEAR_API_KEY=sk_your_key_here
```

Copy from `.env.example` if needed. Get keys in the [Developer Portal](https://api.clearinitiative.io/docs#guide).

### 2. Run smoke tests

```bash
bun run test:clear
```

Run a single test:

```bash
bun run test:clear -- me
bun run test:clear -- afghanistan
bun run test:clear -- events
```

**Auth gate:** `me` must return your email. If `me` is `null`, the key is missing, revoked, or malformed — regenerate in the Developer Portal.

**Public vs authenticated:** `locations(level: 0)` works without auth (useful for sanity checks). `eventsByLocation`, `signalsByLocation`, and `alertsByLocation` require a valid API key.

### 3. What each test does

| Test | Query | Confirms |
|------|-------|----------|
| `me` | `{ me { id email role } }` | API key works |
| `countries` | `locations(level: 0)` | Location hierarchy access |
| `afghanistan` | finds Afghanistan in countries | Country id for downstream queries |
| `events` | `eventsByLocation(locationId)` | Event feed for Afghanistan |
| `signals` | `signalsByLocation(locationId)` | Raw signal feed |
| `alerts` | `alertsByLocation(locationId)` | Published advisories |

Implementation: [`scripts/test-clear-api.ts`](../scripts/test-clear-api.ts) · client: [`scripts/clear/client.ts`](../scripts/clear/client.ts)

---

## Your first request (manual)

Confirm auth with `me`:

```bash
curl -X POST https://api.clearinitiative.io/graphql \
  -H "Authorization: Bearer $CLEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ me { id email role } }"}'
```

List countries:

```bash
curl -X POST https://api.clearinitiative.io/graphql \
  -H "Authorization: Bearer $CLEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ locations(level: 0) { id name population } }"}'
```

Events in a country (replace `LOCATION_ID`):

```bash
curl -X POST https://api.clearinitiative.io/graphql \
  -H "Authorization: Bearer $CLEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"query($loc: String!) { eventsByLocation(locationId: $loc) { id title severity types generalLocation { name } } }","variables":{"loc":"LOCATION_ID"}}'
```

**Location levels:** `0` = country, `1` = state/province, `2` = city, …  
Drill down: `location(id: "...") { children { id name } }`

---

## Query types worth knowing

| Query | Scoped to team? | Best for |
|-------|-----------------|----------|
| `eventsByLocation` | No | Afghanistan-wide event pull (start here) |
| `signalsByLocation` | No | Raw observations under events |
| `alertsByLocation` | No | Published advisories |
| `events` / `signals` / `alerts` | Yes (`teamId`) | Org-specific feeds |
| `eventsPage` / `alertsPage` / `signalsPage` | Filters + pagination | Dashboard lists |
| `entityStats` | Aggregations | Counts by severity, type, day |

For SYNTROFI Phase 3 live stream, **`signalsByLocation` + `eventsByLocation`** map directly to our `CrisisSignal` schema.

---

## How SYNTROFI will use CLEAR

```
CLEAR GraphQL API
       │
       ▼  (server script or backend proxy — key stays secret)
  Normalize → CrisisSignal
       │
       ├── WebSocket/SSE → browser (Phase 3)
       └── Join with static GeoParquet context (DuckDB-WASM, TerraBit pattern)
```

| CLEAR field | SYNTROFI field |
|-------------|----------------|
| `Event.severity` (1–5) | `severity` / `urgency` |
| `Event.types` | `crisis_type` |
| `Signal.source` | `sources[]` |
| `generalLocation` | `location_label`, map point |
| `Alert.status` | `verification_state` proxy |

Static layers (population, health) stay on object storage. **CLEAR supplies the live mutable layer.**

---

## Security checklist

- [x] `.env.local` in `.gitignore`
- [x] `CLEAR_API_KEY` has no `VITE_` prefix (not bundled to browser)
- [x] Production: Vercel serverless proxy at `/api/clear/graphql` holds the key
- [ ] Rotate key if it was ever committed or shared

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `me` returns `null` | Key not accepted — regenerate in Developer Portal, paste into `.env.local` with no quotes/spaces, rerun `bun run test:clear -- me` |
| `You must be logged in` on events/signals | Same as above — authenticated queries need a working key |
| `locations` works but `me` fails | Expected: locations is public; your key still needs fixing |
| `CLEAR_API_KEY not set` | Create `.env.local`; run with `bun run` (auto-loads env) |
| GraphQL field error | Field changed — check live schema in GraphQL Sandbox |
| Empty `eventsByLocation` | Valid — may be no events for that location right now |
| `/api/clear/graphql` 404 on Vercel | Deploy includes `api/clear/graphql.ts` + `vercel.json`; set `CLEAR_API_KEY` in Vercel project env and redeploy |

**Interactive explorer:** GraphQL Sandbox linked from the [CLEAR docs](https://api.clearinitiative.io/docs#guide).
