export type BBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type AoiEntry = {
  id: number;
  bbox: BBox;
  polygon?: [number, number][];
};

export type LayerType =
  | "demographics"
  | "roads"
  | "health"
  | "admin"
  | "security"
  | "population";

export type StaticGeoShard = {
  shard_id: string;
  geohash: string;
  bbox: [number, number, number, number];
  path: string;
  row_count: number;
  layer: LayerType;
  updated_at: string;
};

export type ManifestRow = {
  shard_id: string;
  path: string;
  row_count: number;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  layer: LayerType;
  geohash?: string;
  updated_at?: string;
};

export type HumanitarianFeature = {
  id: string;
  layer: LayerType;
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
};

export type LayerVisibility = Record<LayerType, boolean>;

export type ViewMode = "topk" | "heatmap" | "outlier" | "threshold" | "surprise" | "gradient";

export type RankedRow = {
  id: string;
  bbox: BBox;
  score: number;
  layer: LayerType;
  properties: Record<string, unknown>;
};

export type CandidateRow = {
  id: string;
  bbox: BBox;
  layer: LayerType;
  properties: Record<string, unknown>;
  shard_path: string;
};

export type FilterState = {
  minPopulation?: number;
  minVulnerability?: number;
  layers: LayerVisibility;
};
