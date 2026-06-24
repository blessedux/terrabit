import type { LayerType } from "./types";

export const DATA_BASE_URL =
  import.meta.env.VITE_DATA_BASE_URL || "/data";

export const MANIFEST_URL = `${DATA_BASE_URL}/manifest.json`;

export const AFGHANISTAN_BOUNDS: [number, number, number, number] = [
  60.5, 29.4, 74.9, 38.5
];

export const AFGHANISTAN_CENTER: [number, number] = [66.0, 33.9];

export const LAYER_COLORS: Record<LayerType, string> = {
  population: "#ff6b6b",
  health: "#4ecdc4",
  roads: "#95a5a6",
  security: "#f39c12",
  demographics: "#9b59b6",
  admin: "#3498db",
};

export const LAYER_LABELS: Record<LayerType, string> = {
  population: "Population Density",
  health: "Health Facilities",
  roads: "Roads & Access",
  security: "Security Context",
  demographics: "Demographics",
  admin: "Admin Boundaries",
};

export const DEFAULT_LAYER_VISIBILITY: Record<LayerType, boolean> = {
  population: true,
  health: true,
  roads: true,
  security: true,
  demographics: true,
  admin: true,
};
