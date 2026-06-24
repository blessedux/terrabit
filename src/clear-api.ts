/**
 * Browser client for CLEAR GraphQL via Vite dev proxy (/api/clear/graphql).
 * API key is injected server-side — never exposed to the bundle.
 */

const CLEAR_PROXY = "/api/clear/graphql";

export type ClearMarkerKind = "signal" | "event" | "alert";

export type ClearMapMarker = {
  id: string;
  kind: ClearMarkerKind;
  lng: number;
  lat: number;
  title: string;
  severity: number | null;
  status?: string;
  locationName?: string;
  sourceName?: string;
};

type GraphQLPayload<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export const AFGHANISTAN_LOCATION_ID = "706e13bd-3695-4375-ba1f-3c237c5e4de5";

async function clearGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(CLEAR_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as GraphQLPayload<T>;

  if (!response.ok) {
    const message =
      payload.errors?.map((e) => e.message).join("; ") ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }

  if (!payload.data) {
    throw new Error("GraphQL response missing data");
  }

  return payload.data;
}

type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

function walkCoords(
  coords: unknown,
  visit: (lng: number, lat: number) => void,
): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    visit(coords[0], coords[1]);
    return;
  }
  for (const part of coords) walkCoords(part, visit);
}

/** Extract a representative [lng, lat] from CLEAR GeoJSON geometry. */
export function geometryToLngLat(geometry: unknown): [number, number] | null {
  if (!geometry) return null;

  let geo: GeoJsonGeometry;
  try {
    geo =
      typeof geometry === "string"
        ? (JSON.parse(geometry) as GeoJsonGeometry)
        : (geometry as GeoJsonGeometry);
  } catch {
    return null;
  }

  if (!geo?.type || !geo.coordinates) return null;

  if (geo.type === "Point") {
    const c = geo.coordinates as number[];
    if (c.length >= 2) return [c[0], c[1]];
    return null;
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  walkCoords(geo.coordinates, (lng, lat) => {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  });

  if (!Number.isFinite(minLng)) return null;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

type LocationRow = { id: string; name: string };

type SignalsResult = {
  signalsByLocation: Array<{
    id: string;
    title: string | null;
    severity: number | null;
    source: { name: string } | null;
    generalLocation: { name: string; geometry: unknown } | null;
  }>;
};

type EventsResult = {
  eventsByLocation: Array<{
    id: string;
    title: string;
    severity: number;
    types: string[];
    generalLocation: { name: string; geometry: unknown } | null;
  }>;
};

type AlertsResult = {
  alertsByLocation: Array<{
    id: string;
    status: string;
    event: {
      title: string;
      severity: number;
      types: string[];
      generalLocation: { name: string; geometry: unknown } | null;
    };
  }>;
};

const LOCATION_FRAGMENT = `
  generalLocation { name geometry }
`;

export async function resolveLocationId(nameFragment: string): Promise<string | null> {
  const data = await clearGraphQL<{ locations: LocationRow[] }>(`
    query {
      locations(level: 0) { id name }
    }
  `);

  const needle = nameFragment.toLowerCase();
  const match = data.locations.find((l) => l.name.toLowerCase().includes(needle));
  return match?.id ?? null;
}

export async function resolveAfghanistanLocationId(): Promise<string> {
  return (await resolveLocationId("afghan")) ?? AFGHANISTAN_LOCATION_ID;
}

export async function fetchClearMarkersForRegions(
  nameFragments: string[],
): Promise<ClearMapMarker[]> {
  const data = await clearGraphQL<{ locations: LocationRow[] }>(`
    query {
      locations(level: 0) { id name }
    }
  `);

  const ids: string[] = [];
  for (const fragment of nameFragments) {
    const needle = fragment.toLowerCase();
    const match = data.locations.find((l) =>
      l.name.toLowerCase().includes(needle),
    );
    if (match) ids.push(match.id);
  }

  if (ids.length === 0) {
    ids.push(AFGHANISTAN_LOCATION_ID);
  }

  const batches = await Promise.all(ids.map((id) => fetchClearMarkers(id)));
  const seen = new Set<string>();
  const merged: ClearMapMarker[] = [];
  for (const batch of batches) {
    for (const m of batch) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
  }
  return merged;
}

export async function fetchClearMarkers(
  locationId: string,
): Promise<ClearMapMarker[]> {
  const [signalsData, eventsData, alertsData] = await Promise.all([
    clearGraphQL<SignalsResult>(
      `
      query ($locationId: String!) {
        signalsByLocation(locationId: $locationId) {
          id
          title
          severity
          source { name }
          ${LOCATION_FRAGMENT}
        }
      }
    `,
      { locationId },
    ),
    clearGraphQL<EventsResult>(
      `
      query ($locationId: String!) {
        eventsByLocation(locationId: $locationId) {
          id
          title
          severity
          types
          ${LOCATION_FRAGMENT}
        }
      }
    `,
      { locationId },
    ),
    clearGraphQL<AlertsResult>(
      `
      query ($locationId: String!) {
        alertsByLocation(locationId: $locationId) {
          id
          status
          event {
            title
            severity
            types
            ${LOCATION_FRAGMENT}
          }
        }
      }
    `,
      { locationId },
    ),
  ]);

  const markers: ClearMapMarker[] = [];

  for (const signal of signalsData.signalsByLocation) {
    const coords = geometryToLngLat(signal.generalLocation?.geometry);
    if (!coords) continue;
    markers.push({
      id: signal.id,
      kind: "signal",
      lng: coords[0],
      lat: coords[1],
      title: signal.title ?? "Untitled signal",
      severity: signal.severity,
      locationName: signal.generalLocation?.name,
      sourceName: signal.source?.name,
    });
  }

  for (const event of eventsData.eventsByLocation) {
    const coords = geometryToLngLat(event.generalLocation?.geometry);
    if (!coords) continue;
    markers.push({
      id: event.id,
      kind: "event",
      lng: coords[0],
      lat: coords[1],
      title: event.title,
      severity: event.severity,
      locationName: event.generalLocation?.name,
    });
  }

  for (const alert of alertsData.alertsByLocation) {
    const coords = geometryToLngLat(alert.event.generalLocation?.geometry);
    if (!coords) continue;
    markers.push({
      id: alert.id,
      kind: "alert",
      lng: coords[0],
      lat: coords[1],
      title: alert.event.title,
      severity: alert.event.severity,
      status: alert.status,
      locationName: alert.event.generalLocation?.name,
    });
  }

  return markers;
}
