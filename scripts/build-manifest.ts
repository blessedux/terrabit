#!/usr/bin/env bun

import { splitAfghanistanIntoShards } from "./lib/shard";
import type { LayerType } from "../src/types";
import { writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

type ManifestEntry = {
  shard_id: string;
  path: string;
  row_count: number;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  layer: LayerType;
  geohash: string;
  updated_at: string;
};

async function buildManifest() {
  console.log("Building manifest...");

  const dataDir = join(process.cwd(), "public", "data");
  const manifestEntries: ManifestEntry[] = [];

  const layers: LayerType[] = ["population", "health", "roads", "security", "demographics", "admin"];

  for (const layer of layers) {
    const layerDir = join(dataDir, layer);
    
    try {
      const files = readdirSync(layerDir);
      const parquetFiles = files.filter(f => f.endsWith(".parquet"));

      for (const file of parquetFiles) {
        const filePath = join(layerDir, file);
        const stats = statSync(filePath);
        
        const shardId = file.replace(".parquet", "");
        const relativePath = `${layer}/${file}`;
        
        const mockShard = splitAfghanistanIntoShards(0.5).find(s => s.id === shardId) || {
          id: shardId,
          bbox: { west: 66, south: 33, east: 67, north: 34 },
          geohash: "twxyz"
        };

        manifestEntries.push({
          shard_id: shardId,
          path: relativePath,
          row_count: Math.floor(stats.size / 100),
          xmin: mockShard.bbox.west,
          ymin: mockShard.bbox.south,
          xmax: mockShard.bbox.east,
          ymax: mockShard.bbox.north,
          layer,
          geohash: mockShard.geohash,
          updated_at: stats.mtime.toISOString(),
        });
      }

      console.log(`  ${layer}: ${parquetFiles.length} shards`);
    } catch (err) {
      console.log(`  ${layer}: no shards found (directory may not exist yet)`);
    }
  }

  if (manifestEntries.length === 0) {
    console.log("\nNo parquet shards found. Creating sample manifest...");
    
    const sampleShards = splitAfghanistanIntoShards(2.0).slice(0, 5);
    
    for (const shard of sampleShards) {
      manifestEntries.push({
        shard_id: shard.id,
        path: `population/${shard.id}.parquet`,
        row_count: 1000,
        xmin: shard.bbox.west,
        ymin: shard.bbox.south,
        xmax: shard.bbox.east,
        ymax: shard.bbox.north,
        layer: "population",
        geohash: shard.geohash,
        updated_at: new Date().toISOString(),
      });
    }
    
    console.log(`  Created ${manifestEntries.length} sample manifest entries`);
  }

  const manifestPath = join(dataDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifestEntries, null, 2));
  
  console.log(`\nManifest written to ${manifestPath}`);
  console.log(`Total entries: ${manifestEntries.length}`);
}

buildManifest().catch(console.error);
