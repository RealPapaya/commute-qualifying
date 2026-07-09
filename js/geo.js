// Pure geometry helpers. No DOM, no Leaflet — testable under node.
// Points are [lat, lng]; distances in meters.

const R = 6371000;
const rad = d => d * Math.PI / 180;

export function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Cumulative distance along a polyline: cum[i] = meters from start to point i.
export function cumulativeDistances(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
  }
  return cum;
}

// Local equirectangular projection around a reference latitude — good enough
// for point-to-segment math at commute scale (<100 km).
function toXY(p, refLat) {
  return [rad(p[1]) * Math.cos(rad(refLat)) * R, rad(p[0]) * R];
}

// Project point p onto segment a-b. Returns { t (0..1 along segment), distM
// (perpendicular distance from p to the projection) }.
function projectOnSegment(p, a, b) {
  const refLat = a[0];
  const [px, py] = toXY(p, refLat);
  const [ax, ay] = toXY(a, refLat);
  const [bx, by] = toXY(b, refLat);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 :
    Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx, qy = ay + t * dy;
  return { t, distM: Math.hypot(px - qx, py - qy) };
}

// Project a GPS point onto the whole route polyline.
// Returns { progress (meters along route), offRoute (perpendicular meters),
// segIndex, point ([lat,lng] of the projection) }.
// `hint` (previous progress in meters) restricts the search to a window ahead
// of/behind the last known position so parallel road sections or route
// self-crossings don't yank progress around.
export function projectOnRoute(p, points, cum, hint = null, windowM = 500) {
  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    if (hint != null) {
      // segment's progress range vs window around hint
      if (cum[i + 1] < hint - windowM || cum[i] > hint + windowM) continue;
    }
    const r = projectOnSegment(p, points[i], points[i + 1]);
    const progress = cum[i] + r.t * (cum[i + 1] - cum[i]);
    if (!best || r.distM < best.offRoute) {
      best = { progress, offRoute: r.distM, segIndex: i, point: interp(points[i], points[i + 1], r.t) };
    }
  }
  return best;
}

function interp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Point at a given distance along the route.
export function pointAtDistance(points, cum, d) {
  if (d <= 0) return points[0];
  const total = cum[cum.length - 1];
  if (d >= total) return points[points.length - 1];
  let i = cum.findIndex(c => c > d) - 1;
  if (i < 0) i = 0;
  const span = cum[i + 1] - cum[i];
  const t = span === 0 ? 0 : (d - cum[i]) / span;
  return interp(points[i], points[i + 1], t);
}
