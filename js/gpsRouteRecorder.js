// Pure acceptance rule for GPS route recording. Keeping this separate from
// Leaflet and watchPosition makes the noise threshold easy to verify.
import { haversine } from './geo.js';

export const RECORDING_MAX_ACCURACY_M = 40;
export const RECORDING_MIN_DISTANCE_M = 5;

// Returns the GPS point to append, or null when the fix cannot improve the
// recorded polyline. `coords` mirrors GeolocationPosition.coords.
export function acceptedRecordingPoint(previousPoint, coords, {
  maxAccuracyM = RECORDING_MAX_ACCURACY_M,
  minDistanceM = RECORDING_MIN_DISTANCE_M,
} = {}) {
  const lat = Number(coords?.latitude);
  const lng = Number(coords?.longitude);
  const accuracy = Number(coords?.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180 ||
      !Number.isFinite(accuracy) || accuracy > maxAccuracyM) return null;

  const point = [lat, lng];
  if (previousPoint && haversine(previousPoint, point) < minDistanceM) return null;
  return point;
}
