// Sector boundary editing: draggable handles on the route polyline.
// Boundaries are stored as meters-from-start on the owning route object.
import { cumulativeDistances, projectOnRoute, pointAtDistance } from './geo.js';

const MIN_SECTOR_M = 50; // don't let two boundaries collapse together

let map, getRoute, onChange;
let handles = [];

export function initSectorTool(leafletMap, routeGetter, changed) {
  map = leafletMap;
  getRoute = routeGetter;
  onChange = changed;
}

export function defaultBoundaries(totalM, sectorCount) {
  return Array.from({ length: sectorCount - 1 },
    (_, i) => totalM * (i + 1) / sectorCount);
}

// Show or hide the draggable boundary handles.
export function renderSectorHandles(visible) {
  handles.forEach(h => h.remove());
  handles = [];
  const route = getRoute();
  if (!visible || !route || route.points.length < 2) return;

  const cum = cumulativeDistances(route.points);
  route.sectorBoundaries.forEach((d, i) => {
    const h = L.marker(pointAtDistance(route.points, cum, d), {
      draggable: true,
      icon: L.divIcon({ className: 'sector-handle', iconSize: [14, 14] }),
      title: `Sector ${i + 1} / ${i + 2} boundary`,
    }).addTo(map);
    h.on('drag', () => {
      // snap the handle onto the route as it is dragged
      const ll = h.getLatLng();
      const proj = projectOnRoute([ll.lat, ll.lng], route.points, cum);
      if (proj) h.setLatLng(proj.point);
    });
    h.on('dragend', () => {
      const ll = h.getLatLng();
      const proj = projectOnRoute([ll.lat, ll.lng], route.points, cum);
      if (!proj) return;
      const total = cum[cum.length - 1];
      const lo = (i === 0 ? 0 : route.sectorBoundaries[i - 1]) + MIN_SECTOR_M;
      const hi = (i === route.sectorBoundaries.length - 1 ?
        total : route.sectorBoundaries[i + 1]) - MIN_SECTOR_M;
      route.sectorBoundaries[i] = Math.max(lo, Math.min(hi, proj.progress));
      h.setLatLng(pointAtDistance(route.points, cum, route.sectorBoundaries[i]));
      onChange?.();
    });
    handles.push(h);
  });
}
