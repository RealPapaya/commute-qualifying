// Build a new saved route when a live run leaves its original trace. The
// traveled prefix is retained, then the current GPS position is connected to
// the original finish by OSRM (or a straight fallback when routing is offline).
import { cumulativeDistances, pointAtDistance } from './geo.js';
import { waypointBearings } from './routeRouting.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

export async function requestRoadContinuation(from, to) {
  const waypoints = [from, to];
  const coords = waypoints.map(point => `${point[1]},${point[0]}`).join(';');
  const baseUrl = `${OSRM}${coords}?overview=full&geometries=geojson`;
  const bearings = waypointBearings(waypoints);

  try {
    let response = await fetch(`${baseUrl}&bearings=${encodeURIComponent(bearings)}`,
      { signal: AbortSignal.timeout(6000) });
    let data = await response.json();
    if (data.code !== 'Ok') {
      response = await fetch(baseUrl, { signal: AbortSignal.timeout(6000) });
      data = await response.json();
    }
    if (data.code === 'Ok' && data.routes?.[0]) {
      return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    }
  } catch { /* fall through to the direct continuation */ }
  return waypoints;
}

export function createContinuationRoute(original, run, currentPoint, roadPoints, id) {
  const originalCum = original.cum ?? cumulativeDistances(original.points);
  const prefixEnd = pointAtDistance(original.points, originalCum, run.maxProgress);
  const prefix = original.points.filter((_, index) => originalCum[index] < run.maxProgress);
  const head = dedupePoints([...prefix, prefixEnd, currentPoint]);
  const points = dedupePoints([...head, ...roadPoints]);
  const cum = cumulativeDistances(points);
  const resumeProgress = cumulativeDistances(head).at(-1);
  const total = cum.at(-1);
  const sectorCount = run.ends.length;
  const completedCount = run.crossings.length;
  const sectorBoundaries = run.ends.slice(0, Math.min(completedCount, sectorCount - 1));
  const remainingBoundaries = sectorCount - 1 - sectorBoundaries.length;

  for (let i = 1; i <= remainingBoundaries; i++) {
    sectorBoundaries.push(resumeProgress + (total - resumeProgress) * i / (remainingBoundaries + 1));
  }

  return {
    route: {
      id,
      name: `${original.name} — alternate`,
      waypoints: [original.points[0], currentPoint, original.points.at(-1)],
      snap: true,
      points,
      lights: [],
      sectorBoundaries,
      timingVersion: 1,
      closedLoop: false,
    },
    cum,
    resumeProgress,
  };
}

function dedupePoints(points) {
  return points.filter((point, index) => index === 0 ||
    point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
}
