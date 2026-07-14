// OSRM waypoint bearings inferred from the user's intended direction of travel.
// This makes divided roads prefer the carriageway that does not require a U-turn.
function bearing(from, to) {
  if (!from || !to || (from[0] === to[0] && from[1] === to[1])) return null;
  const lat1 = from[0] * Math.PI / 180;
  const lat2 = to[0] * Math.PI / 180;
  const deltaLng = (to[1] - from[1]) * Math.PI / 180;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

export function waypointBearings(waypoints, range = 90, waypointKinds = []) {
  if (waypoints.length < 2) return '';
  return waypoints.map((point, index) => {
    if (waypointKinds[index] === 'shape') return '';
    const from = index === 0 ? point : waypoints[index - 1];
    const to = index === waypoints.length - 1 ? point : waypoints[index + 1];
    const direction = bearing(from, to);
    return direction === null ? '' : `${direction},${range}`;
  }).join(';');
}
