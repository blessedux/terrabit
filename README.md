# SentryFi Crisis Mesh

Fast humanitarian crisis intelligence map for Afghanistan — process live crisis signals in seconds using browser-side spatial analysis.

## What it does

SentryFi provides NGO analysts with a lightweight, intuitive map interface for live humanitarian data. Built on TerraBit's architecture, it uses DuckDB-WASM for browser-side spatial filtering, MapLibre GL JS for rendering, and static GeoParquet/PMTiles for context layers.

**Current features:**
- Afghanistan-focused map with admin boundaries
- Population density and health facility layers
- Browser-side spatial queries on GeoParquet shards
- AOI drawing tools for region analysis
- GeoParquet export for offline analysis

**Planned features:**
- Live crisis signal stream (WebSocket/SSE)
- deck.gl visualization layers (heatmaps, hexbins, arcs)
- Analyst verification workflow
- Multi-source crisis intelligence

## Architecture

```
src/
├── main.ts          App orchestration, state, event wiring
├── map.ts           MapLibre globe, drawing, layers
├── scoring-worker.ts  Web Worker: humanitarian ranking and scoring
├── db.ts            DuckDB-WASM init, spatial queries, shard loading
├── geocoder.ts      Nominatim search, coordinate parsing
├── export.ts        GeoParquet writer (Thrift footer injection)
├── presets.ts       Afghanistan province AOIs
├── filters.ts       Layer toggles and threshold filters
├── config.ts        Data URLs and layer configuration
├── types.ts         Shared type definitions
├── util.ts          Geometry helpers, color interpolation
└── styles.css       Full UI stylesheet
```

**Stack:** TypeScript, Vite, MapLibre GL JS, DuckDB-WASM, Web Workers, PMTiles. No framework — vanilla DOM.

**Data:** Static humanitarian layers (admin boundaries, population density, health facilities) served as GeoParquet shards and PMTiles. The manifest is queried with DuckDB's spatial extension to load only intersecting shards for the visible AOI.

## Quick start

```bash
# Install dependencies
bun install

# Generate sample data
bun run scripts/build-population.ts
bun run scripts/build-health.ts
bun run scripts/build-manifest.ts

# Start dev server
bun run dev       # http://localhost:5173

# Build for production
bun run build     # production build → dist/
bun run check     # biome lint + format check
```

## Development Status

**Phase 1-2 Complete:**
- ✅ TerraBit-based map shell with Afghanistan defaults
- ✅ Humanitarian data types and layer system
- ✅ DuckDB-WASM manifest-based shard loading
- ✅ Layer toggle controls
- ✅ Afghanistan province presets
- ✅ Stub data pipeline (population, health facilities)
- ✅ IndexedDB caching infrastructure

**Next (Phase 3-5):**
- Live crisis signal stream (WebSocket/SSE)
- deck.gl visualization layers (heatmaps, hexbins)
- Real data sources (HDX, WorldPop, OSM)
- Analyst verification workflow
- PostGIS/Supabase backend

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Built on [TerraBit](https://github.com/blessedux/terrabit) by Isaac Corley

## License

[Apache 2.0](LICENSE)
