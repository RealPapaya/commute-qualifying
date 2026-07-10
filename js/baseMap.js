const HIDDEN_LABELS = ['label_other', 'label_village'];
const PAINT_OVERRIDES = {
  background: { 'background-color': '#f7f3ed' },
  landuse_residential: { 'fill-color': '#f7f3ed' },
  park: { 'fill-color': '#edf3ea' },
  water: { 'fill-color': '#bce8f0' },
  waterway: { 'line-color': '#a9dce7' },
  building: { 'fill-color': '#eceeea', 'fill-opacity': 0.58 },
  highway_path: { 'line-color': '#d7e1e4' },
  highway_minor: { 'line-color': '#cedbe0' },
  highway_major_casing: { 'line-color': '#c7d4d9' },
  highway_major_inner: { 'line-color': '#faf8f3' },
  highway_motorway_casing: { 'line-color': '#bdccd2' },
  highway_motorway_inner: { 'line-color': '#f9f7f1' },
};

export function addBaseMap(map) {
  const layer = L.maplibreGL({
    style: 'https://tiles.openfreemap.org/styles/positron',
  }).addTo(map);

  layer.getMaplibreMap().on('load', event => {
    HIDDEN_LABELS.forEach(id => {
      if (event.target.getLayer(id)) event.target.setLayoutProperty(id, 'visibility', 'none');
    });
    Object.entries(PAINT_OVERRIDES).forEach(([id, properties]) => {
      if (!event.target.getLayer(id)) return;
      Object.entries(properties).forEach(([name, value]) =>
        event.target.setPaintProperty(id, name, value));
    });
  });

  return layer;
}
