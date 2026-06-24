export type RouteResult = {
  geometry: GeoJSON.LineString;
  distance: number;
  duration: number;
};

export type GeocodedLocation = {
  lng: number;
  lat: number;
  displayName: string;
};

const NOMINATIM_BASE = "/api/nominatim";
const OSRM_BASE = "/api/osrm";

export async function geocodePlace(
  query: string,
  countryCodes: string[] = ["sd", "af"]
): Promise<GeocodedLocation | null> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    countrycodes: countryCodes.join(","),
  });

  const response = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
    headers: {
      "User-Agent": "NRC-Clear-TerraBit/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim error: ${response.statusText}`);
  }

  const results = await response.json();
  if (!results || results.length === 0) {
    return null;
  }

  const first = results[0];
  return {
    lng: parseFloat(first.lon),
    lat: parseFloat(first.lat),
    displayName: first.display_name,
  };
}

export async function getRoute(
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number
): Promise<RouteResult | null> {
  const coords = `${startLng},${startLat};${endLng},${endLat}`;
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OSRM error: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.routes || data.routes.length === 0) {
    return null;
  }

  const route = data.routes[0];
  return {
    geometry: route.geometry,
    distance: route.distance,
    duration: route.duration,
  };
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
