import { addBaseMap } from './baseMap.js';

const LOCATIONS = [
  { name: 'Taipei', center: [25.0375, 121.5637], zoom: 14 },
  { name: 'Tokyo', center: [35.6764, 139.7631], zoom: 14 },
  { name: 'Seoul', center: [37.5665, 126.9780], zoom: 14 },
  { name: 'Singapore', center: [1.2903, 103.8519], zoom: 14 },
  { name: 'Paris', center: [48.8566, 2.3522], zoom: 14 },
  { name: 'London', center: [51.5074, -0.1278], zoom: 14 },
  { name: 'New York', center: [40.7484, -73.9857], zoom: 14 },
  { name: 'Barcelona', center: [41.3874, 2.1686], zoom: 14 },
];

const FLY_MS = 6000;
const DRAW_MS = 4800;
const HOLD_MS = 10000;

export function initHomeMap() {
  const map = L.map('home-map', {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    inertia: false,
  }).setView([24, 20], 3);

  addBaseMap(map);
  window._homeMap = map;

  let generation = 0;
  let courseLayer = null;
  let previousLocation = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function play(sequence) {
    while (sequence === generation) {
      const location = randomLocation(previousLocation);
      previousLocation = location.name;
      window._homeMapLocation = location.name;

      courseLayer?.remove();
      courseLayer = null;

      const center = randomNearby(location.center);
      if (reducedMotion) {
        map.setView(center, location.zoom);
      } else {
        map.flyTo(center, location.zoom, { duration: FLY_MS / 1000, easeLinearity: 0.18 });
        await delay(FLY_MS);
        if (sequence !== generation) return;
      }

      const courseType = Math.random() < 0.5 ? 'loop' : 'line';
      const waypoints = courseWaypoints(center, courseType);
      const points = await fetchRoadCourse(waypoints).catch(() => waypoints);
      if (sequence !== generation) return;

      window._homeCourseType = courseType;
      window._homeCoursePoints = points;
      courseLayer = drawCourse(map, points, reducedMotion ? 0 : DRAW_MS);

      if (!reducedMotion) await delay(DRAW_MS);
      if (sequence !== generation) return;
      await delay(HOLD_MS);
      if (reducedMotion) return;
    }
  }

  return {
    setActive(active) {
      generation += 1;
      courseLayer?.remove();
      courseLayer = null;
      if (!active) return;
      map.invalidateSize();
      play(generation);
    },
  };
}

export function courseWaypoints([lat, lng], type, random = Math.random) {
  const angle = random() * Math.PI * 2;
  const radius = 0.014 + random() * 0.009;

  if (type === 'loop') {
    const points = Array.from({ length: 4 }, (_, index) => {
      const direction = angle + index * Math.PI / 2;
      const scale = 0.82 + random() * 0.36;
      return [lat + Math.sin(direction) * radius * scale,
              lng + Math.cos(direction) * radius * scale];
    });
    return points.concat([[...points[0]]]);
  }

  return [-1.4, -0.45, 0.45, 1.4].map((distance, index) => {
    const sideways = index === 0 || index === 3 ? 0 : (random() - 0.5) * radius;
    return [lat + Math.sin(angle) * radius * distance + Math.cos(angle) * sideways,
            lng + Math.cos(angle) * radius * distance - Math.sin(angle) * sideways];
  });
}

async function fetchRoadCourse(waypoints) {
  const coordinates = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`,
      { signal: controller.signal });
    if (!response.ok) throw new Error(`OSRM ${response.status}`);
    const data = await response.json();
    const route = data.routes?.[0]?.geometry?.coordinates;
    if (!route?.length) throw new Error('OSRM returned no route');
    return route.map(([lng, lat]) => [lat, lng]);
  } finally {
    clearTimeout(timeout);
  }
}

function drawCourse(map, points, duration) {
  const group = L.layerGroup().addTo(map);
  const casing = L.polyline(points, {
    color: '#08080b', weight: 9, opacity: 0.78, interactive: false,
    lineCap: 'round', lineJoin: 'round', className: 'home-course-casing',
  }).addTo(group);
  const line = L.polyline(points, {
    color: '#ff352f', weight: 4, opacity: 1, interactive: false,
    lineCap: 'round', lineJoin: 'round', className: 'home-course-line',
  }).addTo(group);

  animatePath(casing, duration);
  animatePath(line, duration);
  return group;
}

function animatePath(layer, duration) {
  const path = layer.getElement();
  if (!path || duration === 0) return;
  const length = path.getTotalLength();
  path.style.strokeDasharray = `${length} ${length}`;
  path.style.strokeDashoffset = String(length);
  path.getBoundingClientRect();
  path.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(.22,.72,.24,1)`;
  path.style.strokeDashoffset = '0';
}

function randomLocation(previousName) {
  const choices = LOCATIONS.filter(location => location.name !== previousName);
  return choices[Math.floor(Math.random() * choices.length)];
}

function randomNearby([lat, lng]) {
  return [lat + randomOffset(), lng + randomOffset()];
}

function randomOffset() {
  return (Math.random() - 0.5) * 0.025;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
