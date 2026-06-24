export function encodeGeohash(lat: number, lng: number, precision: number = 7): string {
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

export function decodeGeohash(hash: string): { lat: number; lng: number; error: { lat: number; lng: number } } {
  const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let latMin = -90, latMax = 90;
  let lngMin = -180, lngMax = 180;

  for (let i = 0; i < hash.length; i++) {
    const ch = base32.indexOf(hash[i]);
    if (ch === -1) throw new Error(`Invalid geohash character: ${hash[i]}`);

    for (let bit = 4; bit >= 0; bit--) {
      const even = (i * 5 + (4 - bit)) % 2 === 0;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if ((ch & (1 << bit)) !== 0) {
          lngMin = mid;
        } else {
          lngMax = mid;
        }
      } else {
        const mid = (latMin + latMax) / 2;
        if ((ch & (1 << bit)) !== 0) {
          latMin = mid;
        } else {
          latMax = mid;
        }
      }
    }
  }

  return {
    lat: (latMin + latMax) / 2,
    lng: (lngMin + lngMax) / 2,
    error: {
      lat: (latMax - latMin) / 2,
      lng: (lngMax - lngMin) / 2,
    },
  };
}

export function getGeohashPrefix(hash: string, prefixLength: number): string {
  return hash.substring(0, Math.min(prefixLength, hash.length));
}
