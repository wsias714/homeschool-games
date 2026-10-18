/* ============================================================
   CARIBBEAN CHART DATA
   Hand-simplified coastlines (lon/lat), island outlines, port
   positions and the voyage route between the five ports, plus a
   simple equirectangular projection into an SVG viewBox. Pure data
   and pure functions only -- game.js draws it, smoke-test.js checks
   it (every port on the chart, every route leg ends at its port).
   Shapes are traced from real coordinates but deliberately coarse:
   this is a picture for five-year-olds, not a navigation chart.
   ============================================================ */

var CHART = (function () {
  var LON0 = -88, LAT0 = 28.5, LON1 = -57.5, LAT1 = 8.5;
  var K = 38;                                   // SVG units per degree of latitude
  var COSLAT = Math.cos(18 * Math.PI / 180);    // squash longitude at the chart's middle latitude
  var WIDTH = Math.round((LON1 - LON0) * COSLAT * K);
  var HEIGHT = Math.round((LAT0 - LAT1) * K);

  function project(lon, lat) {
    return [(lon - LON0) * COSLAT * K, (LAT0 - lat) * K];
  }

  // Polygons: lists of [lon, lat]. Points past the chart edge are fine,
  // the SVG viewBox clips them.
  var LAND = {
    mainland: [[-92, 22], [-90.3, 21.1], [-88.3, 21.55], [-87.05, 21.55], [-86.8, 21.05], [-87.4, 20.3],
      [-87.5, 19.5], [-87.8, 18.3], [-88.3, 17.5], [-88.3, 16.2], [-87.8, 15.85], [-86.5, 15.8],
      [-85.2, 15.95], [-84.0, 15.65], [-83.3, 15.0], [-83.4, 14.0], [-83.55, 12.5], [-83.7, 11.2],
      [-83.1, 10.2], [-82.2, 9.1], [-81.5, 8.8], [-80.2, 9.2], [-79.5, 9.6], [-78.5, 9.4], [-77.3, 8.6],
      [-76.8, 8.3], [-76.3, 9.3], [-75.6, 10.4], [-74.8, 11.0], [-73.6, 11.3], [-72.3, 11.9],
      [-71.9, 12.4], [-71.2, 12.0], [-71.8, 11.1], [-71.3, 10.8], [-70.2, 11.5], [-69.8, 11.45],
      [-69.3, 11.5], [-68.3, 10.85], [-67.0, 10.6], [-65.9, 10.2], [-64.3, 10.3], [-63.8, 10.65],
      [-62.2, 10.7], [-62.6, 10.1], [-61.5, 9.8], [-60.8, 9.2], [-60.0, 8.55], [-59.2, 8.0],
      [-57, 6], [-57, 0], [-92, 0]],
    florida: [[-83.5, 30], [-82.9, 29], [-82.7, 28], [-82.6, 27.2], [-82.0, 26.5], [-81.7, 25.9],
      [-81.1, 25.15], [-80.4, 25.15], [-80.1, 25.9], [-80.05, 26.7], [-80.3, 27.6], [-80.6, 28.4],
      [-81.0, 29.3], [-81.3, 30]],
    cuba: [[-84.95, 21.86], [-84.5, 22.45], [-83.9, 22.75], [-83.1, 23.0], [-82.37, 23.15], [-81.6, 23.1],
      [-81.0, 23.12], [-80.2, 22.95], [-79.5, 22.55], [-78.6, 22.35], [-77.9, 21.9], [-77.2, 21.6],
      [-76.3, 21.2], [-75.6, 20.85], [-74.9, 20.65], [-74.15, 20.25], [-74.5, 20.05], [-75.2, 19.9],
      [-75.9, 19.95], [-76.8, 19.95], [-77.7, 19.85], [-77.2, 20.35], [-77.25, 20.75], [-77.8, 20.75],
      [-78.5, 21.3], [-79.2, 21.55], [-80.0, 21.75], [-80.6, 22.05], [-81.2, 22.1], [-81.8, 22.25],
      [-82.3, 22.6], [-83.0, 22.35], [-83.6, 22.1], [-84.4, 21.8]],
    hispaniola: [[-74.45, 18.45], [-73.6, 18.25], [-72.7, 18.15], [-71.9, 18.05], [-71.4, 17.62],
      [-70.9, 18.2], [-70.1, 18.25], [-69.2, 18.45], [-68.4, 18.6], [-68.7, 18.95], [-69.3, 19.15],
      [-69.7, 19.4], [-69.9, 19.7], [-70.6, 19.8], [-71.3, 19.85], [-71.9, 19.75], [-72.8, 19.95],
      [-73.4, 19.8], [-72.8, 19.35], [-72.75, 18.95], [-72.4, 18.6], [-73.3, 18.55], [-73.9, 18.6]],
    jamaica: [[-78.35, 18.25], [-77.9, 18.5], [-77.1, 18.45], [-76.35, 18.2], [-76.2, 17.95],
      [-76.8, 17.92], [-77.2, 17.72], [-77.8, 17.87], [-78.2, 18.05]],
    puertoRico: [[-67.25, 18.45], [-66.1, 18.48], [-65.6, 18.38], [-65.65, 18.05], [-66.6, 17.95],
      [-67.2, 18.0]]
  };

  // Small islands as ellipses: [lon, lat, rxDeg, ryDeg, rotateDeg].
  var ISLETS = [
    [-78.4, 26.6, 0.65, 0.13, -10], [-77.2, 26.3, 0.18, 0.55, 20], [-78.0, 24.4, 0.35, 0.7, 15],
    [-77.35, 25.03, 0.16, 0.07, 0], [-76.25, 25.2, 0.08, 0.55, -35], [-76.3, 24.0, 0.07, 0.55, -40],
    [-75.45, 24.35, 0.08, 0.3, -30], [-75.1, 23.25, 0.07, 0.4, -35], [-73.4, 21.1, 0.35, 0.15, 0],
    [-73.9, 22.4, 0.2, 0.25, 0], [-71.9, 21.75, 0.3, 0.12, 0], [-82.8, 21.7, 0.45, 0.3, 0],
    [-80.6, 24.95, 0.12, 0.04, -30], [-81.0, 24.72, 0.14, 0.04, -20], [-81.5, 24.6, 0.14, 0.04, -5],
    [-81.25, 19.32, 0.12, 0.05, 0], [-64.8, 18.35, 0.25, 0.08, 0], [-63.05, 18.1, 0.08, 0.06, 0],
    [-62.75, 17.3, 0.08, 0.06, 0], [-61.8, 17.08, 0.1, 0.08, 0], [-61.55, 16.2, 0.2, 0.14, 0],
    [-61.35, 15.42, 0.08, 0.14, 0], [-61.0, 14.65, 0.1, 0.15, 0], [-60.97, 13.9, 0.06, 0.12, 0],
    [-61.2, 13.25, 0.06, 0.09, 0], [-61.68, 12.12, 0.06, 0.08, 0], [-59.55, 13.15, 0.14, 0.18, 0],
    [-61.25, 10.45, 0.4, 0.3, 0], [-60.65, 11.23, 0.12, 0.06, -30], [-70.0, 12.5, 0.1, 0.05, 0],
    [-68.95, 12.18, 0.14, 0.06, 0], [-68.25, 12.18, 0.1, 0.06, 0], [-64.0, 11.0, 0.25, 0.08, 0]
  ];

  // [text, lon, lat, kind] -- 'sea' labels are big italic, 'land' smaller.
  var LABELS = [
    ['Caribbean Sea', -74.2, 14.6, 'sea'],
    ['Atlantic Ocean', -69.5, 26.6, 'sea'],
    ['Gulf of Mexico', -86.1, 25.6, 'sea'],
    ['Cuba', -78.7, 21.95, 'land'],
    ['Hispaniola', -71.0, 19.05, 'land'],
    ['Jamaica', -77.3, 18.9, 'land'],
    ['Puerto Rico', -66.4, 17.45, 'land'],
    ['The Bahamas', -74.6, 25.9, 'land'],
    ['Florida', -81.35, 27.1, 'land'],
    ['Barbados', -59.55, 12.45, 'land'],
    ['Colombia', -74.2, 9.4, 'land'],
    ['Venezuela', -66.2, 9.4, 'land']
  ];

  // Ports in voyage order (matches TUNE.LEVELS ids in game.js). `tag` is
  // where the city name sits relative to the marker: [dx, dy, anchor].
  var PORTS = [
    { id: 1, lon: -77.35, lat: 25.06, tag: [20, -14, 'start'] },   // Nassau
    { id: 2, lon: -82.37, lat: 23.14, tag: [-6, -24, 'middle'] },  // Havana
    { id: 3, lon: -66.11, lat: 18.47, tag: [8, -24, 'middle'] },   // San Juan
    { id: 4, lon: -76.84, lat: 17.94, tag: [0, 38, 'middle'] },    // Port Royal
    { id: 5, lon: -59.62, lat: 13.10, tag: [-6, -24, 'end'] }      // Bridgetown
  ];

  // Each leg sails from port N to port N+1 through open water, so the
  // dotted route never cuts across an island (leg 2 threads between
  // Cuba's eastern tip and Great Inagua rather than over it).
  var LEGS = [
    [[-77.35, 25.06], [-77.8, 25.35], [-79.6, 24.3], [-81.3, 23.55], [-82.37, 23.14]],
    [[-82.37, 23.14], [-79.0, 23.3], [-77.0, 22.55], [-75.3, 21.55], [-73.8, 20.6], [-71.0, 20.25], [-67.8, 19.1], [-66.11, 18.47]],
    [[-66.11, 18.47], [-67.6, 18.75], [-67.95, 18.2], [-68.6, 17.6], [-71.4, 16.9], [-74.5, 17.3], [-76.84, 17.94]],
    [[-76.84, 17.94], [-74.0, 16.0], [-68.0, 14.3], [-62.2, 13.55], [-60.5, 13.5], [-59.62, 13.10]]
  ];

  var ROSE = [-62.4, 24.9];

  function projectAll(points) {
    return points.map(function (p) { return project(p[0], p[1]); });
  }

  function polygonPath(points) {
    return projectAll(points).map(function (p, i) {
      return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ') + ' Z';
  }

  // Catmull-Rom through the waypoints, emitted as cubic Beziers, so
  // route legs read as a ship's curving course rather than a zigzag.
  function smoothPath(points) {
    var p = projectAll(points);
    var d = 'M' + p[0][0].toFixed(1) + ' ' + p[0][1].toFixed(1);
    for (var i = 0; i < p.length - 1; i++) {
      var p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      var c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      var c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ' C' + c1[0].toFixed(1) + ' ' + c1[1].toFixed(1) + ' ' + c2[0].toFixed(1) + ' ' +
        c2[1].toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d;
  }

  function inBounds(lon, lat) {
    return lon >= LON0 && lon <= LON1 && lat <= LAT0 && lat >= LAT1;
  }

  return {
    WIDTH: WIDTH, HEIGHT: HEIGHT, K: K, COSLAT: COSLAT,
    LAND: LAND, ISLETS: ISLETS, LABELS: LABELS, PORTS: PORTS, LEGS: LEGS, ROSE: ROSE,
    project: project, polygonPath: polygonPath, smoothPath: smoothPath, inBounds: inBounds
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CHART;
}
