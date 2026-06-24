# SentryFi Crisis Mesh — Troubleshooting Fixed

## Issues Resolved

### 1. Manifest Format Mismatch
**Problem:** Code was looking for `manifest.parquet` but we had `manifest.json`
**Solution:** Updated `config.ts` to point to `manifest.json`

### 2. DuckDB vs JSON Data Loading
**Problem:** Using DuckDB queries for JSON files
**Solution:** 
- Created `loadManifest()` function to fetch JSON manifest directly
- Updated `fetchShardCandidates()` to handle JSON shard files
- Preserved DuckDB initialization for future Parquet integration

### 3. Native Binding Issues  
**Problem:** Vite 8 rolldown bindings weren't properly installed
**Solution:** Clean reinstall of dependencies (`rm -rf node_modules bun.lockb && bun install`)

## Current Status

The app is now running at **http://localhost:5173** with:

✅ Dev server running without errors
✅ JSON manifest loading
✅ JSON shard data loading
✅ Layer toggles functional
✅ Afghanistan province presets
✅ AOI drawing (rectangle/polygon)
✅ Sample data (population & health facilities)

## No API Keys Required

This is a **frontend-only** application for Phase 1-2:
- No backend API keys needed
- No authentication required
- All data served as static JSON from `public/data/`
- Map tiles from OpenFreeMap (public, no key required)

## How to Use

1. Open http://localhost:5173 in your browser
2. Click one of the province presets (Kabul, Herat, etc.)
3. Or draw a rectangle/polygon over Afghanistan
4. Toggle layers on/off in the left panel
5. View loaded features in the right panel

## Next Steps for Real Data

When ready to use real Parquet files:
1. Run the data build scripts with actual sources
2. Convert JSON to Parquet format
3. The `db.ts` already has Parquet query functions ready
4. Just swap back to using DuckDB queries instead of fetch()

## Files Modified to Fix Issues

- `src/config.ts` - Changed manifest URL to .json
- `src/db.ts` - Added JSON manifest/shard loading functions
- `src/main.ts` - Updated to use new loading functions
- Dependencies reinstalled cleanly
