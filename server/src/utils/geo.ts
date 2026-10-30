export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const pointFrom = ({ lat, lng }: LatLng) => ({ type: 'Point' as const, coordinates: [lng, lat] });

export const latLngOf = (point?: { coordinates?: number[] } | null): LatLng | null =>
  point && point.coordinates && point.coordinates.length === 2 ? { lat: point.coordinates[1], lng: point.coordinates[0] } : null;

/** Reduce coordinate precision (2 decimals ≈ 1.1 km) for viewers who must not see exact locations. */
export function approximate(ll: LatLng, decimals = 2): LatLng {
  const f = 10 ** decimals;
  return { lat: Math.round(ll.lat * f) / f, lng: Math.round(ll.lng * f) / f };
}

/** Unicode-aware tokenizer (keeps Tamil combining marks together). */
export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((t) => t.length > 1);
}

/** Jaccard similarity of word sets, 0..1. */
export function textSimilarity(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((t) => {
    if (B.has(t)) inter += 1;
  });
  return inter / (A.size + B.size - inter);
}
