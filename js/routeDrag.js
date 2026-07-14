// Drag-to-reroute: grab any point on the route's polyline and drag it to add
// an invisible shaping point, bending the route without leaving another map
// marker behind. Reuses the pure projection helpers in geo.js to work out
// which two waypoints the grabbed point falls between.
import { cumulativeDistances, projectOnRoute } from './geo.js';

const DRAG_THRESHOLD_PX = 5; // ignore sub-pixel jitter so a plain click still behaves as a click
const ENDPOINT_SNAP_M = 60;
const ENDPOINT_TRIM_M = 15;

export function normalizeWaypointKinds(waypoints, kinds = []) {
  return waypoints.map((_, index) => {
    if (index === 0 || index === waypoints.length - 1) return 'endpoint';
    return kinds[index] === 'shape' ? 'shape' : 'via';
  });
}

// Pure: move an endpoint. When it is pulled back onto the existing route,
// discard waypoints beyond the drop position so the route becomes shorter
// instead of doubling back. An off-route drop is a normal extension/reroute.
export function moveEndpoint(waypoints, routePoints, kinds, endpoint, point) {
  const nextWaypoints = waypoints.map(p => [...p]);
  const nextKinds = normalizeWaypointKinds(nextWaypoints, kinds);
  const index = endpoint === 'start' ? 0 : nextWaypoints.length - 1;
  if (nextWaypoints.length < 2 || routePoints.length < 2) {
    nextWaypoints[index] = point;
    return { waypoints: nextWaypoints, kinds: nextKinds, trimmed: false };
  }

  const cum = cumulativeDistances(routePoints);
  const projection = projectOnRoute(point, routePoints, cum);
  const total = cum.at(-1);
  const trimsStart = endpoint === 'start' && projection?.offRoute <= ENDPOINT_SNAP_M &&
    projection.progress > ENDPOINT_TRIM_M;
  const trimsEnd = endpoint === 'end' && projection?.offRoute <= ENDPOINT_SNAP_M &&
    projection.progress < total - ENDPOINT_TRIM_M;
  if (!trimsStart && !trimsEnd) {
    nextWaypoints[index] = point;
    return { waypoints: nextWaypoints, kinds: nextKinds, trimmed: false };
  }

  const projected = nextWaypoints.map(waypoint =>
    projectOnRoute(waypoint, routePoints, cum)?.progress ?? 0);
  const keptWaypoints = [];
  const keptKinds = [];
  for (let i = 0; i < nextWaypoints.length; i++) {
    const keep = trimsStart
      ? i === nextWaypoints.length - 1 || (i > 0 && projected[i] > projection.progress)
      : i === 0 || (i < nextWaypoints.length - 1 && projected[i] < projection.progress);
    if (keep) {
      keptWaypoints.push(nextWaypoints[i]);
      keptKinds.push(nextKinds[i]);
    }
  }
  if (trimsStart) {
    keptWaypoints.unshift(projection.point);
    keptKinds.unshift('endpoint');
  } else {
    keptWaypoints.push(projection.point);
    keptKinds.push('endpoint');
  }
  return {
    waypoints: keptWaypoints,
    kinds: normalizeWaypointKinds(keptWaypoints, keptKinds),
    trimmed: true,
  };
}

// Pure: index at which to splice a new waypoint (grabPoint) into `waypoints`,
// given the route's current polyline geometry (`routePoints`, i.e.
// route.points). Projects every waypoint and the grab point onto the
// polyline and returns the index where the grab point's progress falls
// between two consecutive waypoints' own progress.
export function findInsertIndex(waypoints, routePoints, grabPoint) {
  if (waypoints.length < 2 || routePoints.length < 2) return waypoints.length;
  const cum = cumulativeDistances(routePoints);
  const grabProj = projectOnRoute(grabPoint, routePoints, cum);
  if (!grabProj) return waypoints.length;
  const wpProgress = waypoints.map(wp => {
    const proj = projectOnRoute(wp, routePoints, cum);
    return proj ? proj.progress : 0;
  });
  for (let i = 0; i < wpProgress.length - 1; i++) {
    if (grabProj.progress <= wpProgress[i + 1]) return i + 1;
  }
  return wpProgress.length;
}

let map, getRoute, getPolyline, rebuild;
let preview = null;

// { map, getRoute, getPolyline, rebuild, onAfterRebuild }
export function initRouteDrag(opts) {
  ({ map, getRoute, getPolyline, rebuild } = opts);
  opts.onAfterRebuild(bindPolyline);
  bindPolyline();
}

function bindPolyline() {
  const line = getPolyline();
  if (!line) return;
  line.on('mousedown', onGrab);
}

function onGrab(e) {
  const route = getRoute();
  if (!route || route.points.length < 2) return;
  const start = e.latlng;
  const grab = [start.lat, start.lng];
  const idx = findInsertIndex(route.waypoints, route.points, grab);
  const projection = projectOnRoute(grab, route.points, cumulativeDistances(route.points));
  let dragging = false;

  map.dragging.disable();

  function onMove(ev) {
    if (!dragging) {
      const movedPx = map.latLngToContainerPoint(ev.latlng)
        .distanceTo(map.latLngToContainerPoint(start));
      if (movedPx < DRAG_THRESHOLD_PX) return;
      dragging = true;
      route.waypointKinds = normalizeWaypointKinds(route.waypoints, route.waypointKinds);
      route.waypoints.splice(idx, 0, grab);
      route.waypointKinds.splice(idx, 0, 'shape');
      preview = L.polyline(route.points, {
        color: '#40d982', weight: 6, opacity: 0.9, dashArray: '8 8', interactive: false,
        className: 'route-drag-preview',
      }).addTo(map);
    }
    const split = projection?.segIndex ?? 0;
    preview.setLatLngs([
      ...route.points.slice(0, split + 1),
      [ev.latlng.lat, ev.latlng.lng],
      ...route.points.slice(split + 1),
    ]);
  }

  function onUp(ev) {
    map.off('mousemove', onMove);
    map.off('mouseup', onUp);
    map.dragging.enable();
    if (dragging) {
      swallowNextClick();
      route.waypoints[idx] = [ev.latlng.lat, ev.latlng.lng];
      preview.remove();
      preview = null;
      rebuild();
    }
  }

  map.on('mousemove', onMove);
  map.on('mouseup', onUp);
}

// Browsers fire a native 'click' on mouseup regardless of how far the
// pointer moved, which would otherwise fall through to the map's own click
// handler (e.g. adding an extra waypoint in the trace tool, or a light in
// the light tool) right after a real path drag. Swallow exactly that one.
function swallowNextClick() {
  const container = map.getContainer();
  const swallow = ev => {
    ev.stopImmediatePropagation();
    ev.preventDefault();
    container.removeEventListener('click', swallow, true);
  };
  container.addEventListener('click', swallow, true);
}
