import type { BBox } from "./types";

export type AoiPreset = { name: string; tag: string; bbox: BBox };

export const AOI_PRESETS: AoiPreset[] = [
  {
    name: "Kabul",
    tag: "capital region",
    bbox: { west: 68.9, south: 34.4, east: 69.3, north: 34.65 },
  },
  {
    name: "Herat",
    tag: "western region",
    bbox: { west: 62.0, south: 34.2, east: 62.4, north: 34.5 },
  },
  {
    name: "Kandahar",
    tag: "southern region",
    bbox: { west: 65.5, south: 31.4, east: 65.9, north: 31.8 },
  },
  {
    name: "Balkh",
    tag: "northern region",
    bbox: { west: 66.7, south: 36.6, east: 67.2, north: 37.0 },
  },
  {
    name: "Nangarhar",
    tag: "eastern region",
    bbox: { west: 70.3, south: 34.0, east: 70.9, north: 34.5 },
  },
  {
    name: "Helmand",
    tag: "southern region",
    bbox: { west: 63.5, south: 30.8, east: 64.5, north: 31.8 },
  },
  {
    name: "Kunduz",
    tag: "northern region",
    bbox: { west: 68.5, south: 36.5, east: 69.2, north: 37.0 },
  },
  {
    name: "Ghazni",
    tag: "central region",
    bbox: { west: 68.2, south: 33.3, east: 68.7, north: 33.7 },
  },
];
