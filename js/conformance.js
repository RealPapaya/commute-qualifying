// Route-conformance metric — how much of the actually-driven path stayed within
// the route corridor. A lap that strays too far is disqualified (DSQ) and never
// counts toward personal bests. Pure (no DOM), so it imports straight into
// node --test.
import { haversine, projectOnRoute } from './geo.js';
import { OFF_ROUTE_M } from './timing.js';

export const CONFORMANCE_DQ_THRESHOLD = 0.95;

// `trace` is the actually-driven path as [lat,lng] points (the accepted GPS
// fixes for one lap). `points`/`cum` are the route it is measured against. A
// segment counts as on-route only when both of its endpoints project within
// `corridorM` of the route, so a stretch that leaves and returns is fully
// charged as off-route. Returns { conformance (0..1), drivenM, onRouteM }.
// Fewer than two points means nothing was driven yet — treated as conforming.
export function computeConformance(trace, points, cum, corridorM = OFF_ROUTE_M) {
  if (!trace || trace.length < 2 || !points || points.length < 2) {
    return { conformance: 1, drivenM: 0, onRouteM: 0 };
  }
  const onRoute = trace.map(p => {
    const proj = projectOnRoute(p, points, cum);
    return proj != null && proj.offRoute <= corridorM;
  });
  let drivenM = 0, onRouteM = 0;
  for (let i = 1; i < trace.length; i++) {
    const seg = haversine(trace[i - 1], trace[i]);
    drivenM += seg;
    if (onRoute[i - 1] && onRoute[i]) onRouteM += seg;
  }
  return { conformance: drivenM > 0 ? onRouteM / drivenM : 1, drivenM, onRouteM };
}

export function isDisqualified(conformance) {
  return conformance < CONFORMANCE_DQ_THRESHOLD;
}
