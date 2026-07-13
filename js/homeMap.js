import { addBaseMap } from './baseMap.js';
import { haversine } from './geo.js';
import { waypointBearings } from './routeRouting.js';

export const HOME_LOCATIONS = [
  { name: 'Taipei', center: [25.0375, 121.5637], zoom: 14 },
  { name: 'Kaohsiung', center: [22.6273, 120.3014], zoom: 14 },
  { name: 'Taichung', center: [24.1477, 120.6736], zoom: 14 },
  { name: 'Tainan', center: [22.9997, 120.2270], zoom: 14 },
  { name: 'Hsinchu', center: [24.8138, 120.9675], zoom: 14 },
  { name: 'Tokyo', center: [35.6764, 139.7631], zoom: 14 },
  { name: 'Osaka', center: [34.6937, 135.5023], zoom: 14 },
  { name: 'Kyoto', center: [35.0116, 135.7681], zoom: 14 },
  { name: 'Yokohama', center: [35.4437, 139.6380], zoom: 14 },
  { name: 'Seoul', center: [37.5665, 126.9780], zoom: 14 },
  { name: 'Busan', center: [35.1796, 129.0756], zoom: 14 },
  { name: 'Singapore', center: [1.2903, 103.8519], zoom: 14 },
  { name: 'Hong Kong', center: [22.3193, 114.1694], zoom: 14 },
  { name: 'Bangkok', center: [13.7563, 100.5018], zoom: 14 },
  { name: 'Chiang Mai', center: [18.7883, 98.9853], zoom: 14 },
  { name: 'Kuala Lumpur', center: [3.1390, 101.6869], zoom: 14 },
  { name: 'Penang', center: [5.4141, 100.3288], zoom: 14 },
  { name: 'Jakarta', center: [-6.2088, 106.8456], zoom: 14 },
  { name: 'Manila', center: [14.5995, 120.9842], zoom: 14 },
  { name: 'Hanoi', center: [21.0278, 105.8342], zoom: 14 },
  { name: 'Ho Chi Minh City', center: [10.8231, 106.6297], zoom: 14 },
  { name: 'Paris', center: [48.8566, 2.3522], zoom: 14 },
  { name: 'Lyon', center: [45.7640, 4.8357], zoom: 14 },
  { name: 'London', center: [51.5074, -0.1278], zoom: 14 },
  { name: 'Manchester', center: [53.4808, -2.2426], zoom: 14 },
  { name: 'New York', center: [40.7484, -73.9857], zoom: 14 },
  { name: 'Los Angeles', center: [34.0522, -118.2437], zoom: 14 },
  { name: 'Chicago', center: [41.8781, -87.6298], zoom: 14 },
  { name: 'San Francisco', center: [37.7749, -122.4194], zoom: 14 },
  { name: 'Seattle', center: [47.6062, -122.3321], zoom: 14 },
  { name: 'Vancouver', center: [49.2827, -123.1207], zoom: 14 },
  { name: 'Montreal', center: [45.5019, -73.5674], zoom: 14 },
  { name: 'Barcelona', center: [41.3874, 2.1686], zoom: 14 },
  { name: 'Madrid', center: [40.4168, -3.7038], zoom: 14 },
  { name: 'Lisbon', center: [38.7223, -9.1393], zoom: 14 },
  { name: 'Porto', center: [41.1579, -8.6291], zoom: 14 },
  { name: 'Milan', center: [45.4642, 9.1900], zoom: 14 },
  { name: 'Rome', center: [41.9028, 12.4964], zoom: 14 },
  { name: 'Berlin', center: [52.5200, 13.4050], zoom: 14 },
  { name: 'Munich', center: [48.1351, 11.5820], zoom: 14 },
  { name: 'Amsterdam', center: [52.3676, 4.9041], zoom: 14 },
  { name: 'Prague', center: [50.0755, 14.4378], zoom: 14 },
  { name: 'Vienna', center: [48.2082, 16.3738], zoom: 14 },
  { name: 'São Paulo', center: [-23.5505, -46.6333], zoom: 14 },
  { name: 'Rio de Janeiro', center: [-22.9068, -43.1729], zoom: 14 },
  { name: 'Buenos Aires', center: [-34.6037, -58.3816], zoom: 14 },
  { name: 'Santiago', center: [-33.4489, -70.6693], zoom: 14 },
  { name: 'Medellín', center: [6.2442, -75.5812], zoom: 14 },
  { name: 'Sydney', center: [-33.8688, 151.2093], zoom: 14 },
  { name: 'Melbourne', center: [-37.8136, 144.9631], zoom: 14 },
  { name: 'Auckland', center: [-36.8509, 174.7645], zoom: 14 },
  { name: 'Cape Town', center: [-33.9249, 18.4241], zoom: 14 },
  { name: 'Johannesburg', center: [-26.2041, 28.0473], zoom: 14 },
];

const FLY_MS = 6000;
const DRAW_MS = 4800;
const HOLD_MS = 10000;
const PRELOAD_TIMEOUT_MS = 8000;
const VISIBLE_MAP_TIMEOUT_MS = 4000;
const MAX_DETOUR_RATIO = 2.15;
const MAX_BACKTRACK_RATIO = 0.18;

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

  const renderedMap = addBaseMap(map).getMaplibreMap();
  window._homeMap = map;

  let generation = 0;
  let courseLayer = null;
  const nextLocation = createLocationPicker();
  const preloadBaseMap = createBaseMapPreloader();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function prepareCourse() {
    const location = nextLocation();
    const center = randomNearby(location.center);
    const waypoints = courseWaypoints(center);
    const [points] = await Promise.all([
      fetchRoadCourse(waypoints).catch(() => waypoints),
      preloadBaseMap(center, location.zoom),
    ]);
    return { location, center, points };
  }

  async function play(sequence) {
    let prepared = await prepareCourse();
    if (sequence !== generation) return;

    while (sequence === generation) {
      const { location, center, points } = prepared;
      window._homeMapLocation = location.name;

      courseLayer?.remove();
      courseLayer = null;

      if (reducedMotion) {
        map.setView(center, location.zoom);
      } else {
        const moveFinished = waitForMove(map, FLY_MS + 2000);
        map.flyTo(center, location.zoom, { duration: FLY_MS / 1000, easeLinearity: 0.18 });
        await moveFinished;
        if (sequence !== generation) return;
      }

      await waitForMapIdle(renderedMap, VISIBLE_MAP_TIMEOUT_MS);
      if (sequence !== generation) return;

      window._homeCourseType = 'line';
      window._homeCoursePoints = points;
      courseLayer = drawCourse(map, points, reducedMotion ? 0 : DRAW_MS);

      const nextPrepared = reducedMotion ? null : prepareCourse();
      if (!reducedMotion) await delay(DRAW_MS);
      if (sequence !== generation) return;
      await delay(HOLD_MS);
      if (reducedMotion) return;
      prepared = await nextPrepared;
      if (sequence !== generation) return;
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

export function courseWaypoints([lat, lng], random = Math.random) {
  const angle = random() * Math.PI * 2;
  const radius = 0.014 + random() * 0.009;

  return [-1.4, -0.45, 0.45, 1.4].map((distance, index) => {
    const sideways = index === 0 || index === 3 ? 0 : (random() - 0.5) * radius * 0.5;
    return [lat + Math.sin(angle) * radius * distance + Math.cos(angle) * sideways,
            lng + Math.cos(angle) * radius * distance - Math.sin(angle) * sideways];
  });
}

export function courseQuality(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const start = points[0];
  const end = points.at(-1);
  const directDistance = haversine(start, end);
  if (directDistance < 1) return null;

  let routeDistance = 0;
  for (let index = 1; index < points.length; index += 1) {
    routeDistance += haversine(points[index - 1], points[index]);
  }

  const refLat = (start[0] + end[0]) / 2 * Math.PI / 180;
  const xScale = Math.cos(refLat);
  const axisX = (end[1] - start[1]) * xScale;
  const axisY = end[0] - start[0];
  const axisLengthSquared = axisX ** 2 + axisY ** 2;
  let previousProgress = 0;
  let backtrack = 0;
  points.slice(1).forEach(point => {
    const pointX = (point[1] - start[1]) * xScale;
    const pointY = point[0] - start[0];
    const progress = (pointX * axisX + pointY * axisY) / axisLengthSquared;
    if (progress < previousProgress) backtrack += previousProgress - progress;
    previousProgress = progress;
  });

  return {
    detourRatio: routeDistance / directDistance,
    backtrackRatio: backtrack,
  };
}

function pickDirectCourse(courses) {
  return courses.map(points => ({ points, quality: courseQuality(points) }))
    .filter(({ quality }) => quality && quality.detourRatio <= MAX_DETOUR_RATIO &&
      quality.backtrackRatio <= MAX_BACKTRACK_RATIO)
    .sort((a, b) => (a.quality.detourRatio + a.quality.backtrackRatio * 4) -
      (b.quality.detourRatio + b.quality.backtrackRatio * 4))[0]?.points ?? null;
}

async function fetchRoadCourse(waypoints) {
  const coordinates = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const baseUrl =
    `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
    '?overview=full&geometries=geojson&alternatives=true&continue_straight=true';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const bearings = waypointBearings(waypoints);
    let courses = await requestRoadCourses(
      `${baseUrl}&bearings=${encodeURIComponent(bearings)}`, controller.signal);
    let route = pickDirectCourse(courses);
    if (!route) {
      courses = await requestRoadCourses(baseUrl, controller.signal);
      route = pickDirectCourse(courses);
    }
    if (!route) throw new Error('OSRM returned no direct route');
    return route;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestRoadCourses(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) return [];
  const data = await response.json();
  if (data.code !== 'Ok') return [];
  return (data.routes ?? []).map(route =>
    route.geometry.coordinates.map(([lng, lat]) => [lat, lng]));
}

function createBaseMapPreloader() {
  let preloadMap = null;
  let renderedMap = null;

  return async (center, zoom) => {
    if (!preloadMap) {
      // A second off-screen map warms the browser's tile cache while the
      // visible map remains still on the current course.
      const container = document.createElement('div');
      container.setAttribute('aria-hidden', 'true');
      Object.assign(container.style, {
        position: 'fixed',
        inset: '0',
        opacity: '0',
        pointerEvents: 'none',
        transform: 'translateX(-200vw)',
      });
      document.body.append(container);
      preloadMap = L.map(container, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        fadeAnimation: false,
        zoomAnimation: false,
      }).setView(center, zoom);
      renderedMap = addBaseMap(preloadMap).getMaplibreMap();
    } else {
      preloadMap.setView(center, zoom, { animate: false });
    }
    preloadMap.invalidateSize();
    await waitForMapIdle(renderedMap, PRELOAD_TIMEOUT_MS);
  };
}

function waitForMapIdle(map, timeoutMs) {
  if (typeof map.loaded !== 'function' || typeof map.areTilesLoaded !== 'function') {
    return Promise.resolve();
  }
  if (map.loaded() && map.areTilesLoaded()) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    let timeout = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      map.off?.('idle', finish);
      resolve();
    };
    map.on('idle', finish);
    if (!settled) timeout = setTimeout(finish, timeoutMs);
  });
}

function waitForMove(map, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    let timeout = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      map.off?.('moveend', finish);
      resolve();
    };
    map.on('moveend', finish);
    if (!settled) timeout = setTimeout(finish, timeoutMs);
  });
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

export function createLocationPicker(locations = HOME_LOCATIONS, random = Math.random) {
  let bag = [];
  let previousName = null;
  return () => {
    if (!bag.length) {
      bag = [...locations];
      for (let index = bag.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
      }
      if (bag.length > 1 && bag.at(-1).name === previousName) {
        [bag[0], bag[bag.length - 1]] = [bag.at(-1), bag[0]];
      }
    }
    const location = bag.pop();
    previousName = location?.name ?? null;
    return location;
  };
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
