import type { BBox } from "../../src/types";

export function splitAfghanistanIntoShards(
  tileSize: number = 0.5
): Array<{ id: string; bbox: BBox; geohash: string }> {
  const afghanistanBounds = {
    west: 60.5,
    south: 29.4,
    east: 74.9,
    north: 38.5,
  };

  const shards: Array<{ id: string; bbox: BBox; geohash: string }> = [];
  let shardId = 0;

  for (let lng = afghanistanBounds.west; lng < afghanistanBounds.east; lng += tileSize) {
    for (let lat = afghanistanBounds.south; lat < afghanistanBounds.north; lat += tileSize) {
      const west = lng;
      const south = lat;
      const east = Math.min(lng + tileSize, afghanistanBounds.east);
      const north = Math.min(lat + tileSize, afghanistanBounds.north);

      const centerLat = (south + north) / 2;
      const centerLng = (west + east) / 2;
      const geohash = encodeGeohash(centerLat, centerLng, 5);

      shards.push({
        id: `shard_${shardId.toString().padStart(4, "0")}`,
        bbox: { west, south, east, north },
        geohash,
      });
      shardId++;
    }
  }

  return shards;
}

function encodeGeohash(lat: number, lng: number, precision: number): string {
  const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let latMin = -90, latMax = 90;
  let lngMin = -180, lngMax = 180;
  let hash = "";
  let bit = 0;
  let ch = 0;

  for (let i = 0; i < precision * 5; i++) {
    const even = i % 2 === 0;
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng > mid) {
        ch |= 1 << (4 - bit);
        lngMin = mid;
      } else {
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat > mid) {
        ch |= 1 << (4 - bit);
        latMin = mid;
      } else {
        latMax = mid;
      }
    }

    bit++;
    if (bit === 5) {
      hash += base32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

export function getBBoxArea(bbox: BBox): number {
  return (bbox.east - bbox.west) * (bbox.north - bbox.south);
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(
    a.east < b.west ||
    a.west > b.east ||
    a.north < b.south ||
    a.south > b.north
  );
}
