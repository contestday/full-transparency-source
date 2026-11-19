// Ordnance Survey grid references from GPS (WGS84) positions. Pure.
// WGS84 -> OSGB36 by a Helmert transform, then the National Grid's transverse
// Mercator projection. Accurate to a few metres, plenty for a 10-figure
// reference (1 m) shown as 8 figures (10 m).

const rad = (d: number) => (d * Math.PI) / 180;

function toCartesian(lat: number, lng: number, a: number, b: number) {
  const e2 = 1 - (b * b) / (a * a);
  const φ = rad(lat);
  const λ = rad(lng);
  const ν = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  return { x: ν * Math.cos(φ) * Math.cos(λ), y: ν * Math.cos(φ) * Math.sin(λ), z: ν * (1 - e2) * Math.sin(φ) };
}

function toLatLng(p: { x: number; y: number; z: number }, a: number, b: number) {
  const e2 = 1 - (b * b) / (a * a);
  const λ = Math.atan2(p.y, p.x);
  const r = Math.hypot(p.x, p.y);
  let φ = Math.atan2(p.z, r * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const ν = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
    φ = Math.atan2(p.z + e2 * ν * Math.sin(φ), r);
  }
  return { φ, λ };
}

/** Easting and northing on the OS National Grid (metres). */
export function osEastingNorthing(lat: number, lng: number): { e: number; n: number } {
  // WGS84 -> OSGB36 (Helmert, OS published parameters).
  const c = toCartesian(lat, lng, 6378137, 6356752.314245);
  const tx = -446.448, ty = 125.157, tz = -542.06;
  const s = 20.4894e-6;
  const rx = rad(-0.1502 / 3600), ry = rad(-0.247 / 3600), rz = rad(-0.8421 / 3600);
  const x = tx + (1 + s) * c.x - rz * c.y + ry * c.z;
  const y = ty + rz * c.x + (1 + s) * c.y - rx * c.z;
  const z = tz - ry * c.x + rx * c.y + (1 + s) * c.z;
  const a = 6377563.396, b = 6356256.909;
  const { φ, λ } = toLatLng({ x, y, z }, a, b);

  // Transverse Mercator (OS National Grid).
  const F0 = 0.9996012717, φ0 = rad(49), λ0 = rad(-2), N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const ν = (a * F0) / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  const ρ = (a * F0 * (1 - e2)) / (1 - e2 * Math.sin(φ) ** 2) ** 1.5;
  const η2 = ν / ρ - 1;
  const Ma = (1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * (φ - φ0);
  const Mb = (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(φ - φ0) * Math.cos(φ + φ0);
  const Mc = ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * (φ - φ0)) * Math.cos(2 * (φ + φ0));
  const Md = (35 / 24) * n ** 3 * Math.sin(3 * (φ - φ0)) * Math.cos(3 * (φ + φ0));
  const M = b * F0 * (Ma - Mb + Mc - Md);
  const cos = Math.cos(φ), sin = Math.sin(φ), tan = Math.tan(φ);
  const I = M + N0;
  const II = (ν / 2) * sin * cos;
  const III = (ν / 24) * sin * cos ** 3 * (5 - tan ** 2 + 9 * η2);
  const IIIA = (ν / 720) * sin * cos ** 5 * (61 - 58 * tan ** 2 + tan ** 4);
  const IV = ν * cos;
  const V = (ν / 6) * cos ** 3 * (ν / ρ - tan ** 2);
  const VI = (ν / 120) * cos ** 5 * (5 - 18 * tan ** 2 + tan ** 4 + 14 * η2 - 58 * tan ** 2 * η2);
  const dλ = λ - λ0;
  return {
    n: I + II * dλ ** 2 + III * dλ ** 4 + IIIA * dλ ** 6,
    e: E0 + IV * dλ + V * dλ ** 3 + VI * dλ ** 5,
  };
}

/** An OS grid reference, e.g. "SK 3456 8712" (8 figures: to 10 m). Null outside the grid. */
export function osGridRef(lat: number, lng: number, digits: 6 | 8 | 10 = 8): string | null {
  const { e, n } = osEastingNorthing(lat, lng);
  if (!(e >= 0 && e < 700000 && n >= 0 && n < 1300000)) return null;
  const e100k = Math.floor(e / 100000);
  const n100k = Math.floor(n / 100000);
  // Two grid letters (I is not used).
  let l1 = 19 - n100k - ((19 - n100k) % 5) + Math.floor((e100k + 10) / 5);
  let l2 = (((19 - n100k) * 5) % 25) + (e100k % 5);
  if (l1 > 7) l1++;
  if (l2 > 7) l2++;
  const letters = String.fromCharCode(l1 + 65) + String.fromCharCode(l2 + 65);
  const half = digits / 2;
  const fmt = (v: number) => String(Math.floor((v % 100000) / 10 ** (5 - half))).padStart(half, "0");
  return `${letters} ${fmt(e)} ${fmt(n)}`;
}
