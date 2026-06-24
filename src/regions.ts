import type { BBox } from "./types";

export type FocusRegion = "sudan" | "afghanistan";

export type RegionConfig = {
  id: FocusRegion;
  name: string;
  center: [number, number];
  bounds: BBox;
  /** Zoom when focused on country (regional) */
  focusZoom: number;
  /** Zoom when intro ends — still globe-forward */
  introZoom: number;
  clearNameMatch: string;
};

export const REGIONS: Record<FocusRegion, RegionConfig> = {
  sudan: {
    id: "sudan",
    name: "Sudan",
    center: [30.0, 15.5],
    bounds: { west: 21.8, south: 8.7, east: 38.6, north: 23.2 },
    focusZoom: 5.2,
    introZoom: 2.35,
    clearNameMatch: "sudan",
  },
  afghanistan: {
    id: "afghanistan",
    name: "Afghanistan",
    center: [66.0, 33.9],
    bounds: { west: 60.5, south: 29.4, east: 74.9, north: 38.5 },
    focusZoom: 5.5,
    introZoom: 2.35,
    clearNameMatch: "afghan",
  },
};

export const GLOBE_INTRO = {
  startCenter: [-45, 18] as [number, number],
  startZoom: 0.55,
  endCenter: REGIONS.sudan.center,
  endZoom: REGIONS.sudan.introZoom,
  durationMs: 9000,
};

/** Earth rotation: 360° per sidereal day (~86164 s) — NASA-realistic spin rate */
export const EARTH_ROTATION_DEG_PER_MS = 360 / (86_164 * 1000);
