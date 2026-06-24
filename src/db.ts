import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbWorkerEh from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import duckdbWorkerMvp from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdbWasmEh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdbWasmMvp from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";

import { MANIFEST_URL } from "./config";
import type { BBox, CandidateRow, LayerType, ManifestRow } from "./types";
import { normalizeBBox, containsPoint, pointInPolygon } from "./util";

export { MANIFEST_URL };

const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdbWasmMvp, mainWorker: duckdbWorkerMvp },
  eh: { mainModule: duckdbWasmEh, mainWorker: duckdbWorkerEh },
};

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function resolveShardUrl(relativePath: string): string {
  const base = MANIFEST_URL.replace(/\/[^/]+$/, '/');
  try {
    return new URL(relativePath, base).toString();
  } catch {
    return relativePath;
  }
}

function bboxToWKT(b: BBox): string {
  return `POLYGON((${b.west} ${b.south},${b.east} ${b.south},${b.east} ${b.north},${b.west} ${b.north},${b.west} ${b.south}))`;
}

function ringToWKT(ring: [number, number][]): string {
  return `POLYGON((${ring.map(([lng, lat]) => `${lng} ${lat}`).join(",")}))`;
}

function bboxIntersects(bbox1: BBox, bbox2: { xmin: number; ymin: number; xmax: number; ymax: number }): boolean {
  return !(
    bbox1.east < bbox2.xmin ||
    bbox1.west > bbox2.xmax ||
    bbox1.north < bbox2.ymin ||
    bbox1.south > bbox2.ymax
  );
}

export async function loadManifest(
  bbox: BBox,
  enabledLayers: LayerType[],
  polygon?: [number, number][],
): Promise<ManifestRow[]> {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`Failed to load manifest: ${response.statusText}`);
  }
  
  const allRows = await response.json() as ManifestRow[];
  
  return allRows.filter((row) => {
    if (!enabledLayers.includes(row.layer)) {
      return false;
    }
    
    const shardBBox = { xmin: row.xmin, ymin: row.ymin, xmax: row.xmax, ymax: row.ymax };
    return bboxIntersects(bbox, shardBBox);
  });
}

export function buildManifestQuery(
  bbox: BBox,
  enabledLayers: LayerType[],
  polygon?: [number, number][],
): string {
  const wkt = polygon ? ringToWKT(polygon) : bboxToWKT(bbox);
  const layersList = enabledLayers.map((l) => sqlString(l)).join(", ");
  return `
    SELECT shard_id, path, row_count, xmin, ymin, xmax, ymax, layer, geohash, updated_at
    FROM read_parquet(${sqlString(MANIFEST_URL)})
    WHERE ST_Intersects(
      ST_GeomFromText('${wkt}'),
      ST_MakeEnvelope(xmin, ymin, xmax, ymax)
    )
    AND layer IN (${layersList})
    ORDER BY layer, row_count DESC, path ASC
  `.trim();
}

export function buildShardQuery(
  shardUrl: string,
  bbox: BBox,
  polygon?: [number, number][],
): string {
  const wkt = polygon ? ringToWKT(polygon) : bboxToWKT(bbox);
  return `
    SELECT 
      id, 
      bbox,
      layer,
      ST_AsGeoJSON(geometry) as geojson,
      * EXCLUDE (id, bbox, layer, geometry)
    FROM read_parquet(${sqlString(shardUrl)})
    WHERE ST_Intersects(
      ST_GeomFromText('${wkt}'),
      ST_GeomFromWKB(geometry)
    )
  `.trim();
}

export async function fetchShardCandidates(
  db: duckdb.AsyncDuckDB,
  shardUrl: string,
  bbox: BBox,
  layer: LayerType,
  polygon?: [number, number][],
): Promise<CandidateRow[]> {
  const response = await fetch(shardUrl);
  if (!response.ok) {
    console.warn(`Failed to load shard ${shardUrl}: ${response.statusText}`);
    return [];
  }
  
  const features = await response.json() as any[];
  
  return features
    .filter((f) => {
      if (polygon) {
        const center = [(f.bbox.xmin + f.bbox.xmax) / 2, (f.bbox.ymin + f.bbox.ymax) / 2];
        return pointInPolygon(polygon, center[1], center[0]);
      } else {
        return bboxIntersects(bbox, f.bbox);
      }
    })
    .map((f) => ({
      id: f.id,
      bbox: normalizeBBox(f.bbox),
      layer,
      properties: { ...f, bbox: undefined, id: undefined, layer: undefined },
      shard_path: shardUrl,
    }));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        try {
          results[i] = {
            status: "fulfilled",
            value: await worker(items[i], i),
          };
        } catch (err) {
          results[i] = { status: "rejected", reason: err };
        }
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function instantiateDuckDB(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
  if (!bundle.mainWorker) throw new Error("DuckDB bundle missing worker");
  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  try {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const conn = await db.connect();
    await conn.query(
      "INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;",
    );
    await conn.close();
    return db;
  } catch (err) {
    worker.terminate();
    throw err;
  }
}

export function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) dbPromise = instantiateDuckDB();
  return dbPromise;
}
