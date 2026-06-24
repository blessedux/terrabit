import "./styles.css";
import {
  fetchClearMarkersForRegions,
  type ClearMapMarker,
} from "./clear-api";
import {
  getDuckDB,
  loadManifest,
  fetchShardCandidates,
  MANIFEST_URL,
  mapWithConcurrency,
  resolveShardUrl,
} from "./db";
import { GlobeMap } from "./map";
import { AOI_PRESETS } from "./presets";
import { DEFAULT_LAYER_VISIBILITY, LAYER_LABELS } from "./config";
import { getEnabledLayers } from "./filters";
import {
  geocodePlace,
  getRoute,
  formatDistance,
  formatDuration,
  type GeocodedLocation,
  type RouteResult,
} from "./routing";
import type {
  AoiEntry,
  BBox,
  CandidateRow,
  LayerType,
  ManifestRow,
  RankedRow,
  ViewMode,
  LayerVisibility,
} from "./types";
import { centroid, formatLatLng, normalizeBBox } from "./util";
import { REGIONS, type FocusRegion } from "./regions";

const DEFAULT_TOP_K = 50;
const MAX_TOP_K = 100;

type ClearLayerVisibility = {
  signals: boolean;
  events: boolean;
  alerts: boolean;
};

type AccessRouteState = {
  mode: "idle" | "pickOrigin" | "ready";
  origin: { lng: number; lat: number; label?: string } | null;
  destination: ClearMapMarker | null;
  routeGeoJson: GeoJSON.Feature | null;
  loading: boolean;
  error: string | null;
  distance: number | null;
  duration: number | null;
};

type AppState = {
  bboxes: AoiEntry[];
  nextAoiId: number;
  regionRows: Map<number, CandidateRow[]>;
  status: string;
  candidateRows: CandidateRow[];
  results: RankedRow[];
  topK: number;
  viewMode: ViewMode;
  threshold: number;
  overlayVisible: boolean;
  loading: boolean;
  layerVisibility: LayerVisibility;
  clearLayerVisibility: ClearLayerVisibility;
  clearMarkers: ClearMapMarker[];
  clearLoading: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  activeRegion: FocusRegion;
  railTop: { left: number; right: number };
  accessRoute: AccessRouteState;
};

const state: AppState = {
  bboxes: [],
  nextAoiId: 1,
  regionRows: new Map(),
  status: "Draw a region over Afghanistan to load humanitarian data",
  candidateRows: [],
  results: [],
  topK: DEFAULT_TOP_K,
  viewMode: "topk",
  threshold: Infinity,
  overlayVisible: true,
  loading: false,
  layerVisibility: { ...DEFAULT_LAYER_VISIBILITY },
  clearLayerVisibility: { signals: false, events: true, alerts: true },
  clearMarkers: [],
  clearLoading: false,
  leftPanelOpen: false,
  rightPanelOpen: false,
  activeRegion: "sudan",
  railTop: { left: 0.5, right: 0.5 },
  accessRoute: {
    mode: "idle",
    origin: null,
    destination: null,
    routeGeoJson: null,
    loading: false,
    error: null,
    distance: null,
    duration: null,
  },
};

let globe: GlobeMap;
let scoringWorker: Worker | null = null;
let scoringWorkerReady = false;
const regionLoadRunIds = new Map<number, number>();

function renderShell(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("App root missing");
  
  app.innerHTML = `
    <div class="viewport">
      <div id="map" class="map-canvas"></div>

      <header class="hud-brand">
        <div class="brand-text">
          <h1>GCD Global Crisis Detector</h1>
          <p>Clear Thought Crisis Intelligence</p>
        </div>
      </header>

      <div class="hud-status" id="status-pill">
        <span class="status-led"></span>
        <span id="status-text">${state.status}</span>
      </div>

      <div class="region-switcher" id="region-switcher">
        <button type="button" class="region-btn is-active" data-region="sudan">Sudan</button>
        <button type="button" class="region-btn" data-region="afghanistan">Afghanistan</button>
      </div>

      <button type="button" class="panel-expand-rail panel-expand-left" id="expand-left-panel" aria-label="Open layers panel">
        <span class="panel-rail-grip" aria-hidden="true"></span>
        <span>Layers</span>
      </button>
      <button type="button" class="panel-expand-rail panel-expand-right" id="expand-right-panel" aria-label="Open signals panel">
        <span class="panel-rail-grip" aria-hidden="true"></span>
        <span>Signals</span>
      </button>

      <section class="hud-panel hud-panel-left" id="query-panel">
        <header class="panel-head panel-head-row">
          <span class="panel-kicker">Map layers</span>
          <button type="button" class="panel-collapse-btn" id="collapse-left-panel" aria-label="Collapse layers panel">‹</button>
        </header>

        <div class="panel-scroll" id="left-panel-body">
          <div class="roads-hero">
            <label class="roads-hero-toggle">
              <input type="checkbox" id="roads-hero-input" data-layer="roads" ${state.layerVisibility.roads ? "checked" : ""}>
              <span class="roads-hero-copy">
                <span class="roads-hero-title">${LAYER_LABELS.roads}</span>
                <span class="roads-hero-hint">Primary access &amp; route context</span>
              </span>
              <span class="roads-hero-led" aria-hidden="true"></span>
            </label>
          </div>

          <details class="panel-fold">
            <summary class="panel-fold-summary">Context layers</summary>
            <div class="layer-controls" id="layer-controls"></div>
          </details>

          <details class="panel-fold">
            <summary class="panel-fold-summary panel-fold-summary-row">
              <span>CLEAR live data</span>
              <button type="button" id="clear-reload-btn" class="btn btn-ghost btn-xs">Reload</button>
            </summary>
            <div class="layer-controls" id="clear-layer-controls"></div>
            <p class="clear-api-hint" id="clear-api-hint">Live signals, events &amp; alerts</p>
          </details>

          <details class="panel-fold">
            <summary class="panel-fold-summary">Region presets</summary>
            <div class="preset-grid" id="preset-grid"></div>
            <div class="draw-row">
              <button type="button" id="draw-rect-btn" class="btn btn-secondary">Draw Rectangle</button>
              <button type="button" id="draw-poly-btn" class="btn btn-secondary">Draw Polygon</button>
            </div>
          </details>
        </div>
      </section>

      <section class="hud-panel hud-panel-right" id="results-panel">
        <header class="panel-head panel-head-row">
          <div class="panel-head-group">
            <span class="panel-kicker">Events</span>
            <span class="panel-count" id="signal-count">0 items</span>
          </div>
          <button type="button" class="panel-collapse-btn" id="collapse-right-panel" aria-label="Collapse signals panel">›</button>
        </header>
        <div class="panel-scroll signal-list" id="signal-list"></div>
      </section>

      <div class="hud-view-tabs" id="view-tabs">
        <button class="view-tab active" data-mode="topk">Top-K</button>
        <button class="view-tab" data-mode="heatmap">Heatmap</button>
        <button class="view-tab" data-mode="threshold">Threshold</button>
      </div>

      <div class="access-route-modal" id="access-route-modal" style="display: none;">
        <div class="access-route-header">
          <span class="access-route-title">Roads & Access</span>
          <button type="button" class="access-route-close" id="access-route-close" aria-label="Close">&times;</button>
        </div>
        <div class="access-route-body">
          <label class="access-route-label">Start Point</label>
          <div class="access-route-input-row">
            <input type="text" id="route-search-input" class="access-route-input" placeholder="Search for a place...">
            <button type="button" id="route-search-btn" class="btn btn-primary btn-sm">Search</button>
          </div>
          <button type="button" id="route-pick-btn" class="btn btn-secondary btn-sm" style="width: 100%; margin-top: 8px;">Pick on Map</button>
          <div id="route-origin-coords" class="access-route-coords" style="display: none;"></div>
          <div id="route-status" class="access-route-status"></div>
          <div id="route-info" class="access-route-info" style="display: none;">
            <div class="access-route-info-row">
              <span>Distance:</span>
              <strong id="route-distance">—</strong>
            </div>
            <div class="access-route-info-row">
              <span>Duration:</span>
              <strong id="route-duration">—</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  renderLayerControls();
  renderClearLayerControls();
  renderPresetGrid();
  renderSignalList();
  syncPanelChrome();
  wireEvents();
  wireDraggableRails();

  window.setTimeout(() => {
    document.getElementById("query-panel")?.classList.add("panel-animated");
    document.getElementById("results-panel")?.classList.add("panel-animated");
  }, 900);
}

function syncPanelChrome(): void {
  const left = document.getElementById("query-panel");
  const right = document.getElementById("results-panel");
  const expandLeft = document.getElementById("expand-left-panel");
  const expandRight = document.getElementById("expand-right-panel");
  const viewport = document.querySelector(".viewport");

  const vh = viewport?.clientHeight ?? window.innerHeight;

  left?.classList.toggle("is-collapsed", !state.leftPanelOpen);
  right?.classList.toggle("is-collapsed", !state.rightPanelOpen);

  expandLeft?.classList.toggle("is-visible", !state.leftPanelOpen);
  expandRight?.classList.toggle("is-visible", !state.rightPanelOpen);

  const leftTopPx = state.railTop.left * vh;
  const rightTopPx = state.railTop.right * vh;

  if (expandLeft) {
    expandLeft.style.top = `${leftTopPx}px`;
  }
  if (expandRight) {
    expandRight.style.top = `${rightTopPx}px`;
  }

  if (left && !state.leftPanelOpen) {
    left.style.setProperty("--collapse-rail-top", `${leftTopPx}px`);
  }
  if (right && !state.rightPanelOpen) {
    right.style.setProperty("--collapse-rail-top", `${rightTopPx}px`);
  }

  document.querySelectorAll<HTMLButtonElement>(".region-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.region === state.activeRegion);
  });

  const roadsHero = document.getElementById("roads-hero-input") as HTMLInputElement | null;
  if (roadsHero) {
    roadsHero.checked = state.layerVisibility.roads;
    roadsHero.closest(".roads-hero")?.classList.toggle("is-active", state.layerVisibility.roads);
  }
}

function setPanelOpen(side: "left" | "right", open: boolean): void {
  if (side === "left") state.leftPanelOpen = open;
  else state.rightPanelOpen = open;
  syncPanelChrome();
}

function wireDraggableRails(): void {
  const rails: Array<{ id: string; side: "left" | "right" }> = [
    { id: "expand-left-panel", side: "left" },
    { id: "expand-right-panel", side: "right" },
  ];

  for (const { id, side } of rails) {
    const el = document.getElementById(id);
    if (!el) continue;

    let pointerId: number | null = null;
    let startY = 0;
    let startTop = 0;
    let moved = false;

    el.addEventListener("pointerdown", (e: PointerEvent) => {
      pointerId = e.pointerId;
      startY = e.clientY;
      const vh = window.innerHeight;
      startTop = state.railTop[side] * vh;
      moved = false;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener("pointermove", (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      if (Math.abs(e.clientY - startY) > 4) moved = true;
      if (!moved) return;
      el.classList.add("is-dragging");
      const vh = window.innerHeight;
      const min = 72;
      const max = vh - 72;
      const next = Math.min(max, Math.max(min, startTop + (e.clientY - startY)));
      state.railTop[side] = next / vh;
      syncPanelChrome();
    });

    const endDrag = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      el.releasePointerCapture(e.pointerId);
      el.classList.remove("is-dragging");
      if (!moved) {
        setPanelOpen(side, true);
      }
      pointerId = null;
    };

    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
  }
}

function renderClearLayerControls(): void {
  const container = document.getElementById("clear-layer-controls");
  if (!container) return;

  const layers: Array<{ key: keyof ClearLayerVisibility; label: string }> = [
    { key: "signals", label: "Signals" },
    { key: "events", label: "Events" },
    { key: "alerts", label: "Alerts" },
  ];

  container.innerHTML = layers
    .map(
      ({ key, label }) => `
        <label class="layer-toggle">
          <input type="checkbox" data-clear-layer="${key}" ${state.clearLayerVisibility[key] ? "checked" : ""}>
          <span>${label}</span>
          <span class="clear-count" id="clear-count-${key}">0</span>
        </label>
      `,
    )
    .join("");

  container.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const layer = cb.dataset.clearLayer as keyof ClearLayerVisibility;
      state.clearLayerVisibility[layer] = cb.checked;
      globe.setClearLayerVisibility(state.clearLayerVisibility);
      renderSignalList();
    });
  });
}

function updateClearCounts(): void {
  const counts = {
    signals: state.clearMarkers.filter((m) => m.kind === "signal").length,
    events: state.clearMarkers.filter((m) => m.kind === "event").length,
    alerts: state.clearMarkers.filter((m) => m.kind === "alert").length,
  };

  for (const [key, count] of Object.entries(counts)) {
    const el = document.getElementById(`clear-count-${key}`);
    if (el) el.textContent = String(count);
  }
}

async function loadClearData(): Promise<void> {
  const hint = document.getElementById("clear-api-hint");
  const reloadBtn = document.getElementById("clear-reload-btn");

  state.clearLoading = true;
  const regionName = REGIONS[state.activeRegion].name;
  if (hint) hint.textContent = `Loading CLEAR data for ${regionName}…`;
  if (reloadBtn) reloadBtn.setAttribute("disabled", "true");

  try {
    const markers = await fetchClearMarkersForRegions([REGIONS[state.activeRegion].clearNameMatch]);
    state.clearMarkers = markers;
    globe.setClearMarkers(markers);
    globe.setClearLayerVisibility(state.clearLayerVisibility);
    updateClearCounts();
    renderSignalList();

    const summary = `${markers.length} CLEAR markers (${countsLabel(markers)})`;
    if (hint) {
      hint.textContent =
        markers.length > 0
          ? summary
          : `No geolocated CLEAR items for ${regionName} right now.`;
    }
    if (markers.length === 0) {
      state.status = "CLEAR API connected — no geolocated markers yet";
    } else {
      state.status = `CLEAR loaded — ${summary}`;
    }
    updateStatus();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (hint) {
      hint.textContent =
        message.includes("logged in") || message.includes("me returned")
          ? "CLEAR auth failed — regenerate CLEAR_API_KEY in .env.local"
          : `CLEAR error: ${message}`;
    }
    state.status = `CLEAR API error: ${message}`;
    updateStatus();
    console.error("CLEAR load error:", err);
  } finally {
    state.clearLoading = false;
    if (reloadBtn) reloadBtn.removeAttribute("disabled");
  }
}

function countsLabel(markers: ClearMapMarker[]): string {
  const s = markers.filter((m) => m.kind === "signal").length;
  const e = markers.filter((m) => m.kind === "event").length;
  const a = markers.filter((m) => m.kind === "alert").length;
  return `${s} signals, ${e} events, ${a} alerts`;
}

function renderLayerControls(): void {
  const container = document.getElementById("layer-controls");
  if (!container) return;

  const layers: LayerType[] = [
    "population",
    "health",
    "security",
    "demographics",
    "admin",
  ];

  container.innerHTML = layers
    .map(
      (layer) => `
        <label class="layer-toggle">
          <input type="checkbox" data-layer="${layer}" ${state.layerVisibility[layer] ? "checked" : ""}>
          <span>${LAYER_LABELS[layer]}</span>
        </label>
      `,
    )
    .join("");

  container.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const layer = cb.dataset.layer as LayerType;
      state.layerVisibility[layer] = cb.checked;
      if (state.bboxes.length > 0) {
        reloadCurrentRegions();
      }
    });
  });
}

function onRoadsToggle(enabled: boolean): void {
  state.layerVisibility.roads = enabled;
  syncPanelChrome();
  if (state.bboxes.length > 0) {
    reloadCurrentRegions();
  }
  
  const modal = document.getElementById("access-route-modal");
  if (enabled && modal) {
    modal.style.display = "block";
    if (!state.accessRoute.origin) {
      updateRouteStatus("Set a start point to begin routing");
    }
  } else if (modal) {
    modal.style.display = "none";
    clearAccessRoute();
  }
}

function severityLabel(severity: number | null): string {
  if (severity == null) return "Unknown";
  if (severity >= 5) return "Critical";
  if (severity >= 4) return "High";
  if (severity >= 3) return "Medium";
  if (severity >= 2) return "Low";
  return "Minimal";
}

function renderSignalList(): void {
  const list = document.getElementById("signal-list");
  const countEl = document.getElementById("signal-count");
  if (!list || !countEl) return;

  // Only show events in the side panel; alerts appear on map only
  const visible = state.clearMarkers.filter((m) => m.kind === "event");

  countEl.textContent = `${visible.length} event${visible.length === 1 ? "" : "s"}`;

  if (visible.length === 0) {
    list.innerHTML = '<p class="signal-empty">No events loaded — check CLEAR API or layer toggles</p>';
    return;
  }

  list.innerHTML = visible
    .map((m, i) => {
      const sev = severityLabel(m.severity);
      const hasOrigin = !!state.accessRoute.origin;
      return `
        <article class="signal-card signal-card--${m.kind}" style="--i:${i}">
          <header class="signal-card-head">
            <span class="signal-card-kind">${m.kind}</span>
            ${m.severity != null ? `<span class="signal-card-sev">Sev ${m.severity} · ${sev}</span>` : ""}
          </header>
          <h3 class="signal-card-title">${escapeHtml(m.title)}</h3>
          <dl class="signal-card-meta">
            ${m.locationName ? `<div><dt>Location</dt><dd>${escapeHtml(m.locationName)}</dd></div>` : ""}
            ${m.sourceName ? `<div><dt>Source</dt><dd>${escapeHtml(m.sourceName)}</dd></div>` : ""}
            ${m.status ? `<div><dt>Status</dt><dd>${escapeHtml(m.status)}</dd></div>` : ""}
            <div><dt>Coordinates</dt><dd>${m.lat.toFixed(3)}°, ${m.lng.toFixed(3)}°</dd></div>
          </dl>
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button type="button" class="signal-card-fly" data-lng="${m.lng}" data-lat="${m.lat}" style="flex: 1;">Focus on map</button>
            ${hasOrigin ? `<button type="button" class="signal-card-route" data-id="${m.id}" style="flex: 1;">Route here</button>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  list.querySelectorAll<HTMLButtonElement>(".signal-card-fly").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lng = Number.parseFloat(btn.dataset.lng ?? "0");
      const lat = Number.parseFloat(btn.dataset.lat ?? "0");
      globe.map.flyTo({ center: [lng, lat], zoom: 10, essential: true });
    });
  });
  
  list.querySelectorAll<HTMLButtonElement>(".signal-card-route").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const marker = state.clearMarkers.find((m) => m.id === id);
      if (marker) {
        void routeToDestination(marker);
      }
    });
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPresetGrid(): void {
  const grid = document.getElementById("preset-grid");
  if (!grid) return;

  grid.innerHTML = AOI_PRESETS.map(
    (preset) => `
      <button class="preset-card" data-west="${preset.bbox.west}" data-south="${preset.bbox.south}"
              data-east="${preset.bbox.east}" data-north="${preset.bbox.north}">
        <span class="preset-name">${preset.name}</span>
        <span class="preset-tag">${preset.tag}</span>
      </button>
    `
  ).join("");

  grid.querySelectorAll<HTMLButtonElement>(".preset-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bbox: BBox = {
        west: Number.parseFloat(btn.dataset.west!),
        south: Number.parseFloat(btn.dataset.south!),
        east: Number.parseFloat(btn.dataset.east!),
        north: Number.parseFloat(btn.dataset.north!),
      };
      handleDrawComplete({ bbox });
      globe.flyToBBox(bbox);
    });
  });
}

function clearAccessRoute(): void {
  state.accessRoute = {
    mode: "idle",
    origin: null,
    destination: null,
    routeGeoJson: null,
    loading: false,
    error: null,
    distance: null,
    duration: null,
  };
  globe.setAccessRoute(null);
  globe.setRouteEndpoints(null, null);
  
  const coordsEl = document.getElementById("route-origin-coords");
  const infoEl = document.getElementById("route-info");
  if (coordsEl) coordsEl.style.display = "none";
  if (infoEl) infoEl.style.display = "none";
  updateRouteStatus("");
}

function updateRouteStatus(message: string, isError = false): void {
  const statusEl = document.getElementById("route-status");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = isError ? "access-route-status error" : "access-route-status";
  }
}

function setRouteOrigin(lng: number, lat: number, label?: string): void {
  state.accessRoute.origin = { lng, lat, label };
  state.accessRoute.mode = "ready";
  
  const coordsEl = document.getElementById("route-origin-coords");
  if (coordsEl) {
    coordsEl.textContent = label || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
    coordsEl.style.display = "block";
  }
  
  globe.setRouteEndpoints({ lng, lat }, state.accessRoute.destination);
  updateRouteStatus("Origin set. Click a CLEAR marker or signal card to route.");
  renderSignalList();
}

async function routeToDestination(destination: ClearMapMarker): Promise<void> {
  if (!state.accessRoute.origin) {
    updateRouteStatus("Set a start point first", true);
    return;
  }
  
  state.accessRoute.destination = destination;
  state.accessRoute.loading = true;
  updateRouteStatus("Calculating route...");
  
  globe.setRouteEndpoints(state.accessRoute.origin, { lng: destination.lng, lat: destination.lat });
  
  try {
    const result = await getRoute(
      state.accessRoute.origin.lng,
      state.accessRoute.origin.lat,
      destination.lng,
      destination.lat
    );
    
    if (!result) {
      updateRouteStatus("No road route found for these locations", true);
      state.accessRoute.loading = false;
      return;
    }
    
    state.accessRoute.routeGeoJson = {
      type: "Feature",
      geometry: result.geometry,
      properties: {},
    };
    state.accessRoute.distance = result.distance;
    state.accessRoute.duration = result.duration;
    state.accessRoute.loading = false;
    state.accessRoute.error = null;
    
    globe.setAccessRoute(state.accessRoute.routeGeoJson);
    
    const distEl = document.getElementById("route-distance");
    const durEl = document.getElementById("route-duration");
    const infoEl = document.getElementById("route-info");
    
    if (distEl) distEl.textContent = formatDistance(result.distance);
    if (durEl) durEl.textContent = formatDuration(result.duration);
    if (infoEl) infoEl.style.display = "block";
    
    updateRouteStatus(`Route to ${destination.title}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.accessRoute.loading = false;
    state.accessRoute.error = message;
    updateRouteStatus(`Route error: ${message}`, true);
  }
}

function wireAccessRouteUI(): void {
  const closeBtn = document.getElementById("access-route-close");
  const searchBtn = document.getElementById("route-search-btn");
  const searchInput = document.getElementById("route-search-input") as HTMLInputElement;
  const pickBtn = document.getElementById("route-pick-btn");
  
  closeBtn?.addEventListener("click", () => {
    const roadsInput = document.getElementById("roads-hero-input") as HTMLInputElement;
    if (roadsInput) {
      roadsInput.checked = false;
      onRoadsToggle(false);
    }
  });
  
  searchBtn?.addEventListener("click", async () => {
    if (!searchInput || !searchInput.value.trim()) return;
    
    updateRouteStatus("Searching...");
    try {
      const result = await geocodePlace(searchInput.value.trim());
      if (result) {
        setRouteOrigin(result.lng, result.lat, result.displayName);
        globe.map.flyTo({ center: [result.lng, result.lat], zoom: 10, essential: true });
      } else {
        updateRouteStatus("Place not found in this region", true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateRouteStatus(`Search error: ${message}`, true);
    }
  });
  
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      searchBtn?.click();
    }
  });
  
  pickBtn?.addEventListener("click", () => {
    updateRouteStatus("Click on the map to set start point");
    globe.setMapPickMode(true, (lng, lat) => {
      setRouteOrigin(lng, lat);
    });
  });
}

function wireEvents(): void {
  document.getElementById("draw-rect-btn")?.addEventListener("click", () => {
    globe.setDrawMode("rect");
    globe.arm();
  });

  document.getElementById("draw-poly-btn")?.addEventListener("click", () => {
    globe.setDrawMode("polygon");
    globe.arm();
  });

  document.getElementById("clear-reload-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    void loadClearData();
  });

  document.getElementById("collapse-left-panel")?.addEventListener("click", () => {
    setPanelOpen("left", false);
  });
  document.getElementById("collapse-right-panel")?.addEventListener("click", () => {
    setPanelOpen("right", false);
  });

  document.getElementById("roads-hero-input")?.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    onRoadsToggle(checked);
  });

  document.querySelectorAll<HTMLButtonElement>(".region-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const region = btn.dataset.region as FocusRegion;
      if (!region || region === state.activeRegion) return;
      state.activeRegion = region;
      globe.focusRegion(region);
      syncPanelChrome();
      state.status = `Focused on ${REGIONS[region].name}`;
      updateStatus();
      void loadClearData();
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode as ViewMode;
      state.viewMode = mode;
      document.querySelectorAll(".view-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderResults();
    });
  });
  
  wireAccessRouteUI();
}

function initMap(): void {
  const mapEl = document.querySelector<HTMLDivElement>("#map");
  if (!mapEl) throw new Error("Map container missing");

  globe = new GlobeMap(mapEl, {
    onDrawComplete: handleDrawComplete,
    onAoiClick: () => {},
    onNegativeClick: () => {},
    onResultHover: () => {},
    onResultPick: () => {},
    getBBox: () => (state.bboxes.length > 0 ? state.bboxes[0].bbox : null),
    getResults: () => state.results,
    getTopK: () => state.topK,
  });
}

function handleDrawComplete(result: { bbox: BBox; polygon?: [number, number][] }): void {
  const aoiId = state.nextAoiId++;
  const entry: AoiEntry = {
    id: aoiId,
    bbox: result.bbox,
    polygon: result.polygon,
  };
  state.bboxes = [entry];
  
  globe.clearAoi();
  globe.addAoi(entry);
  
  loadRegion(aoiId, result.bbox, result.polygon);
}

async function loadRegion(aoiId: number, bbox: BBox, polygon?: [number, number][]): Promise<void> {
  const runId = Date.now();
  regionLoadRunIds.set(aoiId, runId);

  state.loading = true;
  state.status = "Loading humanitarian data...";
  updateStatus();

  try {
    const db = await getDuckDB();
    const enabledLayers = getEnabledLayers(state.layerVisibility);
    
    if (enabledLayers.length === 0) {
      state.status = "No layers enabled";
      state.loading = false;
      updateStatus();
      return;
    }

    const manifestRows = await loadManifest(bbox, enabledLayers, polygon);

    if (regionLoadRunIds.get(aoiId) !== runId) return;

    state.status = `Loading ${manifestRows.length} shards...`;
    updateStatus();

    const mockFeatures: CandidateRow[] = [];
    for (const row of manifestRows.slice(0, 5)) {
      const shardUrl = resolveShardUrl(row.path);
      
      try {
        const shardFeatures = await fetchShardCandidates(db, shardUrl, bbox, row.layer, polygon);
        mockFeatures.push(...shardFeatures);
      } catch (err) {
        console.warn(`Failed to load shard ${row.path}:`, err);
      }
    }

    if (regionLoadRunIds.get(aoiId) !== runId) return;

    state.regionRows.set(aoiId, mockFeatures);
    state.candidateRows = mockFeatures;
    
    state.results = mockFeatures.map((f, i) => ({
      ...f,
      score: mockFeatures.length - i,
    }));

    state.status = `Loaded ${mockFeatures.length} features from ${manifestRows.length} shards`;
    updateStatus();
    renderResults();

    if (state.results.length > 0) {
      globe.setResults(state.results, state.topK, state.viewMode);
    }
  } catch (err) {
    console.error("Load error:", err);
    state.status = `Error: ${err}`;
    updateStatus();
  } finally {
    state.loading = false;
  }
}

function reloadCurrentRegions(): void {
  for (const aoi of state.bboxes) {
    loadRegion(aoi.id, aoi.bbox, aoi.polygon);
  }
}

function updateStatus(): void {
  const statusText = document.getElementById("status-text");
  if (statusText) {
    statusText.textContent = state.status;
  }
}

function renderResults(): void {
  const resultList = document.getElementById("result-list");
  const resultCount = document.getElementById("result-count");
  
  if (!resultList || !resultCount) return;

  const displayResults = state.results.slice(0, state.topK);
  resultCount.textContent = `${displayResults.length} of ${state.results.length} features`;

  if (displayResults.length === 0) {
    resultList.innerHTML = '<p class="no-results">No features loaded</p>';
    return;
  }

  resultList.innerHTML = displayResults
    .map(
      (r) => `
        <div class="result-item">
          <div class="result-layer">${r.layer}</div>
          <div class="result-id">${r.id}</div>
          <div class="result-props">
            ${Object.entries(r.properties)
              .slice(0, 3)
              .map(([k, v]) => `<span>${k}: ${v}</span>`)
              .join(" · ")}
          </div>
        </div>
      `
    )
    .join("");
}

async function init(): Promise<void> {
  renderShell();
  initMap();
  
  await getDuckDB();
  
  state.status = "Ready — loading CLEAR live data…";
  updateStatus();

  void loadClearData();
}

init().catch(console.error);
