#!/usr/bin/env bun

import { encodeGeohash } from "./lib/geohash";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

async function buildHealthLayer() {
  console.log("Building health facilities layer...");
  console.log("NOTE: This is a stub. Real implementation would:");
  console.log("  1. Download HDX Afghanistan health facilities dataset");
  console.log("  2. Parse CSV/GeoJSON");
  console.log("  3. Convert to GeoParquet with point geometries");
  console.log("  4. Shard by geohash prefix\n");

  const dataDir = join(process.cwd(), "public", "data", "health");
  mkdirSync(dataDir, { recursive: true });

  const mockFacilities = [
    { name: "Kabul Hospital", lat: 34.52, lng: 69.17, type: "hospital" },
    { name: "Herat Clinic", lat: 34.35, lng: 62.2, type: "clinic" },
    { name: "Kandahar Health Center", lat: 31.61, lng: 65.7, type: "health_center" },
    { name: "Mazar-i-Sharif Hospital", lat: 36.71, lng: 67.11, type: "hospital" },
    { name: "Jalalabad Clinic", lat: 34.43, lng: 70.45, type: "clinic" },
  ];

  const features = mockFacilities.map((facility, idx) => ({
    id: `health_${idx.toString().padStart(4, "0")}`,
    bbox: {
      xmin: facility.lng - 0.001,
      ymin: facility.lat - 0.001,
      xmax: facility.lng + 0.001,
      ymax: facility.lat + 0.001,
    },
    layer: "health",
    name: facility.name,
    facility_type: facility.type,
    capacity: Math.floor(Math.random() * 200) + 20,
    lat: facility.lat,
    lng: facility.lng,
    geohash: encodeGeohash(facility.lat, facility.lng, 7),
    geometry: null,
  }));

  const filePath = join(dataDir, "shard_0000.json");
  writeFileSync(filePath, JSON.stringify(features, null, 2));
  console.log(`  Created ${filePath} with ${features.length} facilities`);

  console.log("\nHealth facilities layer stub created.");
  console.log("To implement: Parse HDX dataset → GeoParquet with proper sharding");
}

buildHealthLayer().catch(console.error);
