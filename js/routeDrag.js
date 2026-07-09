// Drag-to-reroute: grab any point on the route's polyline and drag it to
// insert a new via waypoint there, bending the route (like dragging a route
// line in Google Maps). Reuses the pure projection helpers in geo.js to work
// out which two waypoints the grabbed point falls between.
import { cumulativeDistances, projectOnRoute } from './geo.js';

const DRAG_THRESHOLD_PX = 5; // ignore sub-pixel jitter so a plain click still behaves as a click

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
let ghost = null;

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
  let dragging = false;

  map.dragging.disable();

  function onMove(ev) {
    if (!dragging) {
      const movedPx = map.latLngToContainerPoint(ev.latlng)
        .distanceTo(map.latLngToContainerPoint(start));
      if (movedPx < DRAG_THRESHOLD_PX) return;
      dragging = true;
      route.waypoints.splice(idx, 0, grab);
      ghost = L.marker(grab, {
        icon: L.divIcon({ className: 'wp-marker', iconSize: [12, 12] }),
      }).addTo(map);
    }
    ghost.setLatLng(ev.latlng);
  }

  function onUp(ev) {
    map.off('mousemove', onMove);
    map.off('mouseup', onUp);
    map.dragging.enable();
    if (dragging) {
      swallowNextClick();
      route.waypoints[idx] = [ev.latlng.lat, ev.latlng.lng];
      ghost.remove();
      ghost = null;
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
