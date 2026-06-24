// The minified MapLibre bundle broke GeoJSON rendering in our static prod build.
// Use the dev bundle until upstream bundling/minification is safe here again.
import maplibregl from "maplibre-gl/dist/maplibre-gl-dev.js";
import "maplibre-gl/dist/maplibre-gl.css";

import type { ClearMapMarker } from "./clear-api";
import type {
  AoiEntry,
  BBox,
  NegativePoint,
  PositiveMatch,
  PositivePoint,
  RankedRow,
  ViewMode,
} from "./types";
import { centroid, interpolatePlasma } from "./util";
import {
  EARTH_ROTATION_DEG_PER_MS,
  GLOBE_INTRO,
  REGIONS,
  type FocusRegion,
} from "./regions";

const SENTINEL_TILES =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const SENTINEL_ATTRIBUTION =
  'Sentinel-2 cloudless — <a href="https://s2maps.eu" target="_blank" rel="noreferrer">s2maps.eu</a> by <a href="https://eox.at" target="_blank" rel="noreferrer">EOX</a> (Copernicus Sentinel data 2024)';

const DRAWING_TIMEOUT = 300;
const REGION_BOUNDS_MAX_ZOOM = 5;

export type MapCallbacks = {
  onDrawComplete: (result: {
    bbox: BBox;
    polygon?: [number, number][];
  }) => void;
  onAoiClick: (lat: number, lng: number) => void;
  onNegativeClick: (lat: number, lng: number) => void;
  onResultHover: (result: RankedRow | null) => void;
  onResultPick: (result: RankedRow) => void;
  onPolyVertexChange?: (count: number) => void;
  getBBox: () => BBox | null;
  getResults: () => RankedRow[];
  getTopK: () => number;
};

type DrawMode = "rect" | "polygon";

type DrawState = {
  mode: DrawMode;
  startLngLat: maplibregl.LngLat | null;
  startPoint: { x: number; y: number } | null;
  moved: boolean;
  armed: boolean;
  box: HTMLDivElement | null;
  polyVertices: maplibregl.LngLat[];
  polyActive: boolean;
};

export class GlobeMap {
  readonly map: maplibregl.Map;
  private cb: MapCallbacks;
  private _lastResultsKey = "";
  private draw: DrawState = {
    mode: "rect",
    startLngLat: null,
    startPoint: null,
    moved: false,
    armed: false,
    box: null,
    polyVertices: [],
    polyActive: false,
  };
  private styleReady = false;
  private pendingRender: (() => void)[] = [];
  private rotationFrame: number | null = null;
  private rotationPaused = false;
  private userInteracting = false;
  private hasUserInteracted = false;
  private activeRegion: FocusRegion = "sudan";

  constructor(container: HTMLElement, cb: MapCallbacks) {
    this.cb = cb;
    this.map = new maplibregl.Map({
      container,
      style: this.buildStyle(),
      center: GLOBE_INTRO.startCenter,
      zoom: GLOBE_INTRO.startZoom,
      minZoom: 0.35,
      maxZoom: 14,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      dragRotate: true,
      pitchWithRotate: true,
      touchZoomRotate: true,
      renderWorldCopies: false,
    });

    // MapLibre's default boxZoom handler eats shift+drag. We use shift+drag
    // for AOI drawing, so disable it here.
    this.map.boxZoom.disable();

    this.map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        visualizePitch: true,
      }),
      "top-right",
    );

    this.map.on("load", () => {
      try {
        this.map.setProjection({ type: "globe" });
      } catch {
        /* older builds */
      }
      this.addSources();
      this.addLayers();
      this.styleReady = true;
      this.map.resize();
      this.playIntro();
      for (const fn of this.pendingRender.splice(0)) fn();
    });

    this.map.on("dragstart", () => {
      this.userInteracting = true;
      this.hasUserInteracted = true;
      this.pauseRotation();
    });
    this.map.on("zoomstart", () => {
      this.userInteracting = true;
      this.hasUserInteracted = true;
      this.pauseRotation();
    });
    this.map.on("rotatestart", () => {
      this.userInteracting = true;
      this.hasUserInteracted = true;
      this.pauseRotation();
    });
    this.map.on("moveend", () => {
      if (this.userInteracting) {
        this.userInteracting = false;
        if (!this.hasUserInteracted) {
          window.setTimeout(() => this.resumeRotation(), 2500);
        } else {
          this.stopRotation();
        }
      }
    });
    this.map.on("zoomend", () => {
      const zoom = this.map.getZoom();
      if (zoom < REGION_BOUNDS_MAX_ZOOM) {
        this.map.setMaxBounds(null);
      }
      if (!this.draw.armed) {
        this.map.dragPan.enable();
      }
    });

    // Keep the map sized to its container — catches late layout shifts.
    const ro = new ResizeObserver(() => this.map.resize());
    ro.observe(container);
    window.addEventListener("resize", () => this.map.resize());

    this.wireDrawing();
    this.wireClicks();
  }

  private buildStyle(): maplibregl.StyleSpecification {
    return {
      version: 8,
      projection: { type: "globe" },
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        sentinel: {
          type: "raster",
          tiles: [SENTINEL_TILES],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 14,
          attribution: SENTINEL_ATTRIBUTION,
        },
        "ofm-boundaries": {
          type: "vector",
          url: "https://tiles.openfreemap.org/planet",
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
        },
      },
      layers: [
        {
          id: "bg",
          type: "background",
          paint: { "background-color": "#1a1612" },
        },
        {
          id: "sentinel",
          type: "raster",
          source: "sentinel",
          paint: {
            "raster-opacity": 1,
            "raster-fade-duration": 260,
          },
        },
        {
          id: "countries-line",
          type: "line",
          source: "ofm-boundaries",
          "source-layer": "boundary",
          filter: [
            "all",
            ["==", ["get", "admin_level"], 2],
            ["==", ["get", "maritime"], 0],
          ],
          paint: {
            "line-color": "rgba(255, 248, 232, 0.45)",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              0.5,
              4,
              0.8,
              8,
              1.2,
            ],
          },
        },
        {
          id: "states-line",
          type: "line",
          source: "ofm-boundaries",
          "source-layer": "boundary",
          minzoom: 3,
          filter: [
            "all",
            ["==", ["get", "admin_level"], 4],
            ["==", ["get", "maritime"], 0],
          ],
          paint: {
            "line-color": "rgba(255, 248, 232, 0.35)",
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 8, 1.1],
            "line-dasharray": [3, 2],
          },
        },
        {
          id: "country-label",
          type: "symbol",
          source: "ofm-boundaries",
          "source-layer": "place",
          maxzoom: 7,
          filter: ["==", ["get", "class"], "country"],
          layout: {
            "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
            "text-font": ["Open Sans Regular"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              10,
              4,
              13,
              6,
              15,
            ],
            "text-max-width": 8,
          },
          paint: {
            "text-color": "rgba(255, 248, 232, 0.9)",
            "text-halo-color": "rgba(15, 10, 8, 0.65)",
            "text-halo-width": 1.5,
          },
        },
        {
          id: "state-label",
          type: "symbol",
          source: "ofm-boundaries",
          "source-layer": "place",
          minzoom: 4,
          maxzoom: 10,
          filter: ["==", ["get", "class"], "state"],
          layout: {
            "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
            "text-font": ["Open Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 13],
            "text-max-width": 6,
          },
          paint: {
            "text-color": "rgba(255, 248, 232, 0.7)",
            "text-halo-color": "rgba(15, 10, 8, 0.6)",
            "text-halo-width": 1,
          },
        },
        {
          id: "city-label",
          type: "symbol",
          source: "ofm-boundaries",
          "source-layer": "place",
          minzoom: 6,
          filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
          layout: {
            "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
            "text-font": ["Open Sans Regular"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6,
              10,
              10,
              13,
              14,
              16,
            ],
            "text-max-width": 8,
            "text-anchor": "top",
            "text-offset": [0, 0.3],
          },
          paint: {
            "text-color": "rgba(255, 248, 232, 0.85)",
            "text-halo-color": "rgba(15, 10, 8, 0.65)",
            "text-halo-width": 1.2,
          },
        },
        {
          id: "water-label",
          type: "symbol",
          source: "ofm-boundaries",
          "source-layer": "water_name",
          layout: {
            "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
            "text-font": ["Open Sans Regular"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              11,
              4,
              13,
              8,
              15,
            ],
            "text-max-width": 8,
            "text-letter-spacing": 0.1,
          },
          paint: {
            "text-color": "rgba(140, 190, 220, 0.75)",
            "text-halo-color": "rgba(10, 20, 35, 0.55)",
            "text-halo-width": 1.2,
          },
        },
      ],
      sky: {
        "sky-color": "#2b1a10",
        "horizon-color": "#6b3a1c",
        "fog-color": "#1a1612",
        "fog-ground-blend": 0.5,
        "horizon-fog-blend": 0.5,
        "sky-horizon-blend": 0.8,
        "atmosphere-blend": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0,
          1,
          6,
          0.5,
          12,
          0,
        ],
      },
    } as unknown as maplibregl.StyleSpecification;
  }

  private addSources(): void {
    const empty = { type: "FeatureCollection", features: [] } as const;
    for (const id of [
      "aoi",
      "positives",
      "negatives",
      "positive-matches",
      "results",
      "preview",
      "draft",
      "poly-draft",
      "clear-signals",
      "clear-events",
      "clear-alerts",
      "access-origin",
      "access-destination",
      "access-route",
    ]) {
      this.map.addSource(id, { type: "geojson", data: empty as any });
    }
  }

  private addLayers(): void {
    // AOI bbox
    this.map.addLayer({
      id: "aoi-fill",
      type: "fill",
      source: "aoi",
      paint: {
        "fill-color": "#e5a853",
        "fill-opacity": 0.06,
      },
    });
    this.map.addLayer({
      id: "aoi-line",
      type: "line",
      source: "aoi",
      paint: {
        "line-color": "#e5a853",
        "line-width": 1.6,
        "line-dasharray": [2, 2],
      },
    });

    // Draft AOI while dragging
    this.map.addLayer({
      id: "draft-fill",
      type: "fill",
      source: "draft",
      paint: { "fill-color": "#e5a853", "fill-opacity": 0.08 },
    });
    this.map.addLayer({
      id: "draft-line",
      type: "line",
      source: "draft",
      paint: { "line-color": "#e5a853", "line-width": 1.6 },
    });

    // Live polygon draw preview
    this.map.addLayer({
      id: "poly-draft-line",
      type: "line",
      source: "poly-draft",
      paint: {
        "line-color": "#e5a853",
        "line-width": 1.6,
        "line-dasharray": [2, 2],
      },
    });
    this.map.addLayer({
      id: "poly-draft-vertices",
      type: "circle",
      source: "poly-draft",
      filter: ["==", "$type", "Point"],
      paint: { "circle-radius": 4, "circle-color": "#e5a853" },
    });

    // Ranked results
    this.map.addLayer({
      id: "results-fill",
      type: "fill",
      source: "results",
      paint: {
        "fill-color": ["coalesce", ["get", "color"], "#d0542c"],
        "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0.18],
      },
    });
    this.map.addLayer({
      id: "results-line",
      type: "line",
      source: "results",
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#d0542c"],
        "line-width": ["coalesce", ["get", "lineWidth"], 1.2],
        "line-opacity": 0.9,
      },
    });

    // Positive-match tiles (the exemplar patch underneath each point)
    this.map.addLayer({
      id: "positive-match-fill",
      type: "fill",
      source: "positive-matches",
      paint: { "fill-color": "#c74633", "fill-opacity": 0.16 },
    });
    this.map.addLayer({
      id: "positive-match-line",
      type: "line",
      source: "positive-matches",
      paint: { "line-color": "#c74633", "line-width": 1.6 },
    });

    // CLEAR API markers (signals / events / alerts)
    const clearLayer = (
      id: string,
      source: string,
      color: string,
      radius: number,
    ) => {
      this.map.addLayer({
        id: `${id}-halo`,
        type: "circle",
        source,
        paint: {
          "circle-radius": radius + 6,
          "circle-color": color,
          "circle-opacity": 0.22,
        },
      });
      this.map.addLayer({
        id,
        type: "circle",
        source,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "severity"], 3],
            1,
            radius - 2,
            5,
            radius + 4,
          ],
          "circle-color": color,
          "circle-stroke-color": "#f3ecd8",
          "circle-stroke-width": 1.5,
        },
      });
    };

    clearLayer("clear-signals", "clear-signals", "#60a5fa", 5);
    clearLayer("clear-events", "clear-events", "#f97316", 6);
    clearLayer("clear-alerts", "clear-alerts", "#ef4444", 7);

    // Only alerts show popup on click; events are shown in side panel
    this.map.on("click", "clear-alerts", (e) =>
      this.showClearPopup(e, "clear-alerts"),
    );
    this.map.on("click", "clear-signals", (e) =>
      this.showClearPopup(e, "clear-signals"),
    );
    
    for (const layer of ["clear-alerts", "clear-events", "clear-signals"]) {
      this.map.on("mouseenter", layer, () => {
        this.map.getCanvas().style.cursor = "pointer";
      });
      this.map.on("mouseleave", layer, () => {
        this.map.getCanvas().style.cursor = "";
      });
    }

    // Roads & Access routing layers
    this.map.addLayer({
      id: "access-route",
      type: "line",
      source: "access-route",
      paint: {
        "line-color": "#d0542c",
        "line-width": 5,
        "line-opacity": 0.9,
      },
    });
    this.map.addLayer({
      id: "access-origin",
      type: "circle",
      source: "access-origin",
      paint: {
        "circle-radius": 8,
        "circle-color": "#22c55e",
        "circle-stroke-color": "#f3ecd8",
        "circle-stroke-width": 2,
      },
    });
    this.map.addLayer({
      id: "access-destination",
      type: "circle",
      source: "access-destination",
      paint: {
        "circle-radius": 8,
        "circle-color": "#d0542c",
        "circle-stroke-color": "#f3ecd8",
        "circle-stroke-width": 2,
      },
    });

    // Preview (hover) bbox
    this.map.addLayer({
      id: "preview-line",
      type: "line",
      source: "preview",
      paint: {
        "line-color": "#ffffff",
        "line-width": 2,
        "line-dasharray": [3, 2],
      },
    });

    // Positive points
    this.map.addLayer({
      id: "positives-halo",
      type: "circle",
      source: "positives",
      paint: {
        "circle-radius": 11,
        "circle-color": "#c74633",
        "circle-opacity": 0.18,
      },
    });
    this.map.addLayer({
      id: "positives-dot",
      type: "circle",
      source: "positives",
      paint: {
        "circle-radius": 5,
        "circle-color": "#c74633",
        "circle-stroke-color": "#f3ecd8",
        "circle-stroke-width": 1.5,
      },
    });

    // Negative points (blue)
    this.map.addLayer({
      id: "negatives-halo",
      type: "circle",
      source: "negatives",
      paint: {
        "circle-radius": 11,
        "circle-color": "#3b82f6",
        "circle-opacity": 0.18,
      },
    });
    this.map.addLayer({
      id: "negatives-dot",
      type: "circle",
      source: "negatives",
      paint: {
        "circle-radius": 5,
        "circle-color": "#3b82f6",
        "circle-stroke-color": "#f3ecd8",
        "circle-stroke-width": 1.5,
      },
    });
  }

  private playIntro(): void {
    this.pauseRotation();
    this.map.jumpTo({
      center: GLOBE_INTRO.startCenter,
      zoom: GLOBE_INTRO.startZoom,
      pitch: 0,
      bearing: 0,
    });

    this.map.flyTo({
      center: GLOBE_INTRO.endCenter,
      zoom: GLOBE_INTRO.endZoom,
      pitch: 0,
      bearing: 0,
      duration: GLOBE_INTRO.durationMs,
      essential: true,
      curve: 1.1,
    });

    this.map.once("moveend", () => {
      this.activeRegion = "sudan";
      if (!this.hasUserInteracted) {
        this.resumeRotation();
      }
    });
  }

  private tickRotation = (timestamp: number): void => {
    if (this.rotationFrame === null) return;

    if (!this.rotationPaused && !this.userInteracting && !this.map.isMoving()) {
      const center = this.map.getCenter();
      const zoom = this.map.getZoom();
      if (zoom <= 4.5) {
        const dt = this._lastRotationTs ? timestamp - this._lastRotationTs : 16;
        const lng =
          center.lng - EARTH_ROTATION_DEG_PER_MS * dt * (zoom < 2 ? 1.4 : 1);
        this.map.setCenter([lng, center.lat]);
      }
    }
    this._lastRotationTs = timestamp;
    this.rotationFrame = requestAnimationFrame(this.tickRotation);
  };

  private _lastRotationTs = 0;

  startRotation(): void {
    if (this.rotationFrame !== null) return;
    this.rotationPaused = false;
    this.rotationFrame = requestAnimationFrame(this.tickRotation);
  }

  pauseRotation(): void {
    this.rotationPaused = true;
  }

  resumeRotation(): void {
    this.rotationPaused = false;
    if (this.rotationFrame === null) {
      this.startRotation();
    }
  }

  stopRotation(): void {
    this.rotationPaused = true;
    if (this.rotationFrame !== null) {
      cancelAnimationFrame(this.rotationFrame);
      this.rotationFrame = null;
    }
  }

  focusRegion(region: FocusRegion, opts: { zoom?: number } = {}): void {
    this.activeRegion = region;
    const cfg = REGIONS[region];
    this.pauseRotation();
    this.map.setMaxBounds(null);
    this.map.flyTo({
      center: cfg.center,
      zoom: opts.zoom ?? cfg.focusZoom,
      pitch: 0,
      duration: 2200,
      essential: true,
    });
    this.map.once("moveend", () => {
      const zoom = this.map.getZoom();
      if (zoom >= REGION_BOUNDS_MAX_ZOOM) {
        this.map.setMaxBounds([
          cfg.bounds.west,
          cfg.bounds.south,
          cfg.bounds.east,
          cfg.bounds.north,
        ]);
      }
      if (!this.hasUserInteracted) {
        window.setTimeout(() => this.resumeRotation(), 2000);
      }
    });
  }

  getActiveRegion(): FocusRegion {
    return this.activeRegion;
  }

  private whenReady(fn: () => void): void {
    if (this.styleReady) fn();
    else this.pendingRender.push(fn);
  }

  setAois(entries: Pick<AoiEntry, "bbox" | "polygon">[]): void {
    this.whenReady(() => {
      const src = this.map.getSource("aoi") as maplibregl.GeoJSONSource;
      src?.setData({
        type: "FeatureCollection",
        features: entries.map((e) =>
          e.polygon ? ringToFeature(e.polygon) : bboxToPolygon(e.bbox),
        ),
      });
    });
  }

  private setPolyDraft(vertices: maplibregl.LngLat[] | null): void {
    const src = this.map.getSource("poly-draft") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    if (!vertices || vertices.length < 2) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const coords = vertices.map((v) => [v.lng, v.lat] as [number, number]);
    const ring = coords.length >= 3 ? [...coords, coords[0]] : coords;
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: ring },
          properties: {},
        },
        ...coords.map((c) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: c },
          properties: {},
        })),
      ],
    });
  }

  setDraft(bbox: BBox | null): void {
    const src = this.map.getSource("draft") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: bbox ? [bboxToPolygon(bbox)] : [],
    });
  }

  setPositives(points: PositivePoint[]): void {
    this.whenReady(() => {
      const src = this.map.getSource("positives") as maplibregl.GeoJSONSource;
      src?.setData({
        type: "FeatureCollection",
        features: points.map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          properties: { id: p.id },
        })),
      });
    });
  }

  setNegatives(points: NegativePoint[]): void {
    this.whenReady(() => {
      const src = this.map.getSource("negatives") as maplibregl.GeoJSONSource;
      src?.setData({
        type: "FeatureCollection",
        features: points.map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          properties: { id: p.id },
        })),
      });
    });
  }

  setPositiveMatches(matches: PositiveMatch[]): void {
    this.whenReady(() => {
      const src = this.map.getSource(
        "positive-matches",
      ) as maplibregl.GeoJSONSource;
      src?.setData({
        type: "FeatureCollection",
        features: matches.map((m) =>
          bboxToPolygon(m.candidate.bbox, { id: m.pointId }),
        ),
      });
    });
  }

  setResults(results: RankedRow[], topK: number, viewMode: ViewMode): void {
    this.whenReady(() => {
      const src = this.map.getSource("results") as maplibregl.GeoJSONSource;
      if (!src) return;

      if (!results.length) {
        if (this._lastResultsKey) {
          src.setData({ type: "FeatureCollection", features: [] });
          this._lastResultsKey = "";
        }
        this.map.setFilter("results-fill", null);
        this.map.setFilter("results-line", null);
        return;
      }

      const n = results.length;
      const dataKey = results.map((r) => r.chips_id).join("\0");
      if (dataKey !== this._lastResultsKey) {
        const features = results.map((r, i) => {
          const t = n > 1 ? i / (n - 1) : 0;
          return bboxToPolygon(r.bbox, {
            chipsId: r.chips_id,
            score: r.score,
            rank: i,
            heatColor: interpolatePlasma(t),
            heatFillOpacity: 0.28 - t * 0.14,
          });
        });
        src.setData({ type: "FeatureCollection", features });
        this._lastResultsKey = dataKey;
      }

      this._applyViewStyle(viewMode, topK, n);
    });
  }

  private _applyViewStyle(
    viewMode: ViewMode,
    topK: number,
    total: number,
  ): void {
    const rankFilter =
      viewMode === "topk" && total > 0
        ? (["<", ["get", "rank"], topK] as any)
        : null;
    this.map.setFilter("results-fill", rankFilter);
    this.map.setFilter("results-line", rankFilter);

    if (viewMode !== "topk") {
      this.map.setPaintProperty("results-fill", "fill-color", [
        "coalesce",
        ["get", "heatColor"],
        "#d0542c",
      ]);
      this.map.setPaintProperty("results-fill", "fill-opacity", [
        "coalesce",
        ["get", "heatFillOpacity"],
        0.18,
      ]);
      this.map.setPaintProperty("results-line", "line-color", [
        "coalesce",
        ["get", "heatColor"],
        "#d0542c",
      ]);
      this.map.setPaintProperty("results-line", "line-width", 0.6);
      this.map.setPaintProperty("results-line", "line-opacity", 0.9);
    } else {
      this.map.setPaintProperty("results-fill", "fill-color", "#d0542c");
      this.map.setPaintProperty(
        "results-fill",
        "fill-opacity",
        total > 1
          ? ([
              "interpolate",
              ["linear"],
              ["get", "rank"],
              0,
              0.18,
              Math.min(topK - 1, total - 1),
              0.08,
            ] as any)
          : 0.18,
      );
      this.map.setPaintProperty("results-line", "line-color", "#d0542c");
      this.map.setPaintProperty("results-line", "line-width", 1.4);
      this.map.setPaintProperty("results-line", "line-opacity", 0.9);
    }
  }

  setPreview(result: RankedRow | null): void {
    this.whenReady(() => {
      const src = this.map.getSource("preview") as maplibregl.GeoJSONSource;
      src?.setData({
        type: "FeatureCollection",
        features: result ? [bboxToPolygon(result.bbox)] : [],
      });
    });
  }

  setClearMarkers(markers: ClearMapMarker[]): void {
    this.whenReady(() => {
      const byKind = {
        signal: markers.filter((m) => m.kind === "signal"),
        event: markers.filter((m) => m.kind === "event"),
        alert: markers.filter((m) => m.kind === "alert"),
      };

      const toFeatures = (items: ClearMapMarker[]) =>
        items.map((m) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [m.lng, m.lat],
          },
          properties: {
            id: m.id,
            kind: m.kind,
            title: m.title,
            severity: m.severity,
            status: m.status ?? "",
            locationName: m.locationName ?? "",
            sourceName: m.sourceName ?? "",
          },
        }));

      const sources: Array<[string, ClearMapMarker[]]> = [
        ["clear-signals", byKind.signal],
        ["clear-events", byKind.event],
        ["clear-alerts", byKind.alert],
      ];

      for (const [sourceId, items] of sources) {
        const src = this.map.getSource(sourceId) as maplibregl.GeoJSONSource;
        src?.setData({
          type: "FeatureCollection",
          features: toFeatures(items),
        });
      }
    });
  }

  setClearLayerVisibility(visibility: {
    signals: boolean;
    events: boolean;
    alerts: boolean;
  }): void {
    this.whenReady(() => {
      const layers: Array<[keyof typeof visibility, string]> = [
        ["signals", "clear-signals"],
        ["events", "clear-events"],
        ["alerts", "clear-alerts"],
      ];

      for (const [key, baseId] of layers) {
        const vis = visibility[key] ? "visible" : "none";
        for (const id of [baseId, `${baseId}-halo`]) {
          if (this.map.getLayer(id)) {
            this.map.setLayoutProperty(id, "visibility", vis);
          }
        }
      }
    });
  }

  private showClearPopup(
    e: maplibregl.MapMouseEvent & {
      features?: maplibregl.MapGeoJSONFeature[];
    },
    layerId: string,
  ): void {
    const feature = e.features?.[0];
    if (!feature) return;

    const props = feature.properties ?? {};
    const kind = String(props.kind ?? layerId.replace("clear-", ""));
    const title = String(props.title ?? "CLEAR item");
    const severity = props.severity ? `Severity ${props.severity}` : "";
    const location = props.locationName
      ? String(props.locationName)
      : "";
    const status = props.status ? `Status: ${props.status}` : "";
    const source = props.sourceName ? `Source: ${props.sourceName}` : "";

    const html = `
      <div class="clear-popup-card">
        <span class="clear-popup-kind">${kind}</span>
        <strong class="clear-popup-title">${title}</strong>
        ${severity ? `<span class="clear-popup-sev">${severity}</span>` : ""}
        ${location ? `<span class="clear-popup-row">${location}</span>` : ""}
        ${status ? `<span class="clear-popup-row">${status}</span>` : ""}
        ${source ? `<span class="clear-popup-row">${source}</span>` : ""}
      </div>
    `;

    new maplibregl.Popup({
      closeButton: true,
      maxWidth: "300px",
      className: "clear-glass-popup",
    })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(this.map);
  }

  setAccessRoute(geojson: GeoJSON.Feature | null): void {
    this.whenReady(() => {
      const src = this.map.getSource("access-route") as maplibregl.GeoJSONSource;
      if (geojson) {
        src?.setData({
          type: "FeatureCollection",
          features: [geojson],
        });
      } else {
        src?.setData({
          type: "FeatureCollection",
          features: [],
        });
      }
    });
  }

  setRouteEndpoints(
    origin: { lng: number; lat: number } | null,
    destination: { lng: number; lat: number } | null,
  ): void {
    this.whenReady(() => {
      const originSrc = this.map.getSource("access-origin") as maplibregl.GeoJSONSource;
      const destSrc = this.map.getSource("access-destination") as maplibregl.GeoJSONSource;

      if (origin) {
        originSrc?.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [origin.lng, origin.lat],
              },
              properties: {},
            },
          ],
        });
      } else {
        originSrc?.setData({ type: "FeatureCollection", features: [] });
      }

      if (destination) {
        destSrc?.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [destination.lng, destination.lat],
              },
              properties: {},
            },
          ],
        });
      } else {
        destSrc?.setData({ type: "FeatureCollection", features: [] });
      }
    });
  }

  setMapPickMode(
    enabled: boolean,
    onPick?: (lng: number, lat: number) => void,
  ): void {
    if (enabled) {
      this.map.getCanvas().style.cursor = "crosshair";
      const handler = (e: maplibregl.MapMouseEvent) => {
        if (onPick) {
          onPick(e.lngLat.lng, e.lngLat.lat);
        }
        this.map.off("click", handler);
        this.map.getCanvas().style.cursor = "";
      };
      this.map.on("click", handler);
    } else {
      this.map.getCanvas().style.cursor = "";
    }
  }

  flyToBBox(bbox: BBox, opts: { zoom?: number } = {}): void {
    const c = centroid(bbox);
    this.map.flyTo({
      center: [c.lng, c.lat],
      zoom: opts.zoom ?? Math.max(this.map.getZoom(), 10),
      speed: 1.2,
      curve: 1.4,
      essential: true,
    });
  }

  fitBounds(
    bbox: BBox,
    opts: { padding?: number; maxZoom?: number } = {},
  ): void {
    this.map.fitBounds(
      [
        [bbox.west, bbox.south],
        [bbox.east, bbox.north],
      ],
      {
        padding: opts.padding ?? 80,
        maxZoom: opts.maxZoom ?? 12,
        duration: 1800,
        curve: 1.4,
        essential: true,
      },
    );
  }

  armDraw(on: boolean, mode: DrawMode = "rect"): void {
    this.draw.armed = on;
    this.draw.mode = mode;
    const c = this.map.getCanvas();
    c.style.cursor = on ? "crosshair" : "";
    // Disable double-click zoom while in polygon mode so it doesn't
    // conflict with double-click-to-close on desktop.
    if (on && mode === "polygon") {
      this.map.doubleClickZoom.disable();
    } else if (!on) {
      this.map.doubleClickZoom.enable();
    }
  }

  isArmed(): boolean {
    return this.draw.armed;
  }

  getDrawMode(): DrawMode {
    return this.draw.mode;
  }

  cancelDraft(): void {
    this.draw.startLngLat = null;
    this.draw.startPoint = null;
    this.draw.moved = false;
    this.draw.polyVertices = [];
    this.draw.polyActive = false;
    this.removeDomBox();
    this.setDraft(null);
    this.setPolyDraft(null);
    this.map.dragPan.enable();
  }

  /** Close the current polygon (if ≥ 3 vertices). Used by the mobile "Done" button. */
  finishPolygon(): boolean {
    if (this.draw.mode !== "polygon" || this.draw.polyVertices.length < 3)
      return false;
    const verts = this.draw.polyVertices;
    const ring: [number, number][] = [
      ...verts.map((v) => [v.lng, v.lat] as [number, number]),
      [verts[0].lng, verts[0].lat],
    ];
    const bbox = ringToBBox(ring);
    this.draw.polyVertices = [];
    this.draw.polyActive = false;
    this.draw.armed = false;
    this.map.getCanvas().style.cursor = "";
    this.setPolyDraft(null);
    this.cb.onDrawComplete({ bbox, polygon: ring });
    return true;
  }

  /** Number of polygon vertices currently placed. */
  getPolyVertexCount(): number {
    return this.draw.polyVertices.length;
  }

  private wireDrawing(): void {
    const canvas = () => this.map.getCanvas();

    // ── Shared draw-start / draw-move / draw-end for both mouse + touch ──────

    const drawStart = (
      lngLat: maplibregl.LngLat,
      point: { x: number; y: number },
      ev: Event,
    ) => {
      ev.preventDefault();
      this.map.dragPan.disable();
      this.draw.startLngLat = lngLat;
      this.draw.startPoint = point;
      this.draw.moved = false;
      this.ensureDomBox(point.x, point.y);
    };

    const drawMove = (
      lngLat: maplibregl.LngLat,
      point: { x: number; y: number },
    ) => {
      if (
        this.draw.mode === "rect" &&
        this.draw.startLngLat &&
        this.draw.startPoint
      ) {
        this.draw.moved = true;
        this.updateDomBox(point.x, point.y);
        this.setDraft(bboxFromLngLats(this.draw.startLngLat, lngLat));
      } else if (this.draw.mode === "polygon" && this.draw.polyActive) {
        this.setPolyDraft([...this.draw.polyVertices, lngLat]);
      }
    };

    const drawEnd = (lngLat: maplibregl.LngLat) => {
      if (this.draw.mode !== "rect" || !this.draw.startLngLat) return;
      const start = this.draw.startLngLat;
      const moved = this.draw.moved;
      this.draw.startLngLat = null;
      this.draw.startPoint = null;
      this.draw.moved = false;
      this.removeDomBox();
      this.setDraft(null);
      this.map.dragPan.enable();
      this.draw.armed = false;
      canvas().style.cursor = "";
      if (!moved) return;
      const bbox = bboxFromLngLats(start, lngLat);
      this.cb.onDrawComplete({ bbox });
    };

    // ── Rectangle mode (mouse) ────────────────────────────────────────────────
    this.map.on("mousedown", (e) => {
      if (
        !(e.originalEvent.shiftKey || this.draw.armed) ||
        this.draw.mode !== "rect"
      )
        return;
      drawStart(e.lngLat, e.point, e.originalEvent);
    });
    this.map.on("mousemove", (e) => drawMove(e.lngLat, e.point));
    this.map.on("mouseup", (e) => drawEnd(e.lngLat));

    // ── Rectangle mode (touch) ────────────────────────────────────────────────
    this.map.on("touchstart", (e) => {
      if (!this.draw.armed || this.draw.mode !== "rect") return;
      drawStart(e.lngLat, e.point, e.originalEvent);
    });
    this.map.on("touchmove", (e) => {
      if (!this.draw.startLngLat) return;
      e.originalEvent.preventDefault();
      drawMove(e.lngLat, e.point);
    });
    this.map.on("touchend", (e) => {
      if (!this.draw.startLngLat) return;
      drawEnd(e.lngLat);
    });

    // ── Polygon mode ─────────────────────────────────────────────────────────
    this.map.on("click", (e) => {
      if (!this.draw.armed || this.draw.mode !== "polygon") return;
      if (e.originalEvent.detail === 2) return; // skip second click of a dblclick
      this.draw.polyActive = true;
      this.draw.polyVertices.push(e.lngLat);
      this.setPolyDraft([...this.draw.polyVertices]);
      this.cb.onPolyVertexChange?.(this.draw.polyVertices.length);
    });

    this.map.on("dblclick", (e) => {
      if (!this.draw.armed || this.draw.mode !== "polygon") return;
      if (this.draw.polyVertices.length < 3) return;
      e.preventDefault();
      const verts = this.draw.polyVertices;
      const ring: [number, number][] = [
        ...verts.map((v) => [v.lng, v.lat] as [number, number]),
        [verts[0].lng, verts[0].lat],
      ];
      const bbox = ringToBBox(ring);
      this.draw.polyVertices = [];
      this.draw.polyActive = false;
      this.draw.armed = false;
      canvas().style.cursor = "";
      this.setPolyDraft(null);
      this.cb.onDrawComplete({ bbox, polygon: ring });
    });
  }

  private wireClicks(): void {
    // Right-click → negative exemplar
    this.map.on("contextmenu", (e) => {
      e.originalEvent.preventDefault();
      if (this.draw.startLngLat) return;
      const { lat, lng } = e.lngLat;
      this.cb.onNegativeClick(lat, lng);
    });

    // Long-press (touch) → negative exemplar (mobile equivalent of right-click)
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressLngLat: { lat: number; lng: number } | null = null;
    this.map.on("touchstart", (e) => {
      if (this.draw.armed) return;
      if (e.originalEvent.touches.length !== 1) return;
      longPressLngLat = e.lngLat;
      longPressTimer = setTimeout(() => {
        if (longPressLngLat) {
          this.cb.onNegativeClick(longPressLngLat.lat, longPressLngLat.lng);
        }
        longPressTimer = null;
        longPressLngLat = null;
      }, 500);
    });
    const cancelLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPressLngLat = null;
    };
    this.map.on("touchmove", cancelLongPress);
    this.map.on("touchend", cancelLongPress);
    this.map.on("touchcancel", cancelLongPress);

    this.map.on("click", (e) => {
      if (this.draw.armed && this.draw.mode === "polygon") return;
      if (this.draw.startLngLat) return;
      // Shift+click → negative exemplar
      if (e.originalEvent.shiftKey && !this.draw.armed) {
        const { lat, lng } = e.lngLat;
        this.cb.onNegativeClick(lat, lng);
        return;
      }
      // Click on a result tile -> treat as picking an exemplar
      const hits = this.map.queryRenderedFeatures(e.point, {
        layers: ["results-fill"],
      });
      if (hits.length) {
        const props = hits[0].properties as { chipsId?: string };
        const results = this.cb.getResults();
        const row = results.find((r) => r.chips_id === props.chipsId);
        if (row) {
          this.cb.onResultPick(row);
          return;
        }
      }
      const { lat, lng } = e.lngLat;
      this.cb.onAoiClick(lat, lng);
    });

    this.map.on("mousemove", "results-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const props = f.properties as { chipsId?: string };
      const row = this.cb
        .getResults()
        .find((r) => r.chips_id === props.chipsId);
      if (row) this.cb.onResultHover(row);
      this.map.getCanvas().style.cursor = this.draw.armed
        ? "crosshair"
        : "pointer";
    });
    this.map.on("mouseleave", "results-fill", () => {
      this.cb.onResultHover(null);
      if (!this.draw.armed) this.map.getCanvas().style.cursor = "";
    });
  }

  private ensureDomBox(x: number, y: number): void {
    if (this.draw.box) return;
    const box = document.createElement("div");
    box.className = "draw-box";
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = "0px";
    box.style.height = "0px";
    this.map.getCanvasContainer().appendChild(box);
    this.draw.box = box;
  }

  private updateDomBox(x: number, y: number): void {
    if (!this.draw.box || !this.draw.startPoint) return;
    const sx = this.draw.startPoint.x;
    const sy = this.draw.startPoint.y;
    const left = Math.min(sx, x);
    const top = Math.min(sy, y);
    const w = Math.abs(x - sx);
    const h = Math.abs(y - sy);
    this.draw.box.style.left = `${left}px`;
    this.draw.box.style.top = `${top}px`;
    this.draw.box.style.width = `${w}px`;
    this.draw.box.style.height = `${h}px`;
  }

  private removeDomBox(): void {
    this.draw.box?.remove();
    this.draw.box = null;
  }
}

function bboxFromLngLats(a: maplibregl.LngLat, b: maplibregl.LngLat): BBox {
  return {
    west: Math.min(a.lng, b.lng),
    east: Math.max(a.lng, b.lng),
    south: Math.min(a.lat, b.lat),
    north: Math.max(a.lat, b.lat),
  };
}

function ringToFeature(
  ring: [number, number][],
  properties: Record<string, unknown> = {},
): GeoJSON.Feature {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

function ringToBBox(ring: [number, number][]): BBox {
  const lngs = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  return {
    west: Math.min(...lngs),
    east: Math.max(...lngs),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

function bboxToPolygon(
  bbox: BBox,
  properties: Record<string, unknown> = {},
): GeoJSON.Feature {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [bbox.west, bbox.south],
          [bbox.east, bbox.south],
          [bbox.east, bbox.north],
          [bbox.west, bbox.north],
          [bbox.west, bbox.south],
        ],
      ],
    },
  };
}
