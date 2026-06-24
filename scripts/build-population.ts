#!/usr/bin/env bun

import { splitAfghanistanIntoShards } from "./lib/shard";
import { encodeGeohash } from "./lib/geohash";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

async function buildPopulationLayer() {
  console.log("Building population density layer...");
  console.log("NOTE: This is a stub. Real implementation would:");
  console.log("  1. Download WorldPop Afghanistan 100m raster");
  console.log("  2. Aggregate to ~1km grid cells");
  console.log("  3. Convert to GeoParquet with geometry column");
  console.log("  4. Shard by Afghanistan tiles\n");

  const dataDir = join(process.cwd(), "public", "data", "population");
  mkdirSync(dataDir, { recursive: true });

  const shards = splitAfghanistanIntoShards(1.0);
  
  for (const shard of shards.slice(0, 3)) {
    const mockFeatures = [];
    
    const cellSize = 0.05;
    for (let lng = shard.bbox.west; lng < shard.bbox.east; lng += cellSize) {
      for (let lat = shard.bbox.south; lat < shard.bbox.north; lat += cellSize) {
        mockFeatures.push({
          id: `pop_${encodeGeohash(lat, lng, 7)}`,
          bbox: {
            xmin: lng,
            ymin: lat,
            xmax: lng + cellSize,
            ymax: lat + cellSize,
          },
          layer: "population",
          population_density: Math.floor(Math.random() * 5000),
          geometry: null,
        });
      }
    }

    const filePath = join(dataDir, `${shard.id}.json`);
    writeFileSync(filePath, JSON.stringify(mockFeatures, null, 2));
    console.log(`  Created ${filePath} with ${mockFeatures.length} cells`);
  }

  console.log("\nPopulation layer stub created.");
  console.log("To implement: Use GDAL/DuckDB to process actual WorldPop GeoTIFF → GeoParquet");
}

buildPopulationLayer().catch(console.error);
