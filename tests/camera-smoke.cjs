require("../src/camera.js");
const assert = require("assert");
const camera = globalThis.TF.createCamera({ margin: 18 });
const width = 830;
const height = 420;
camera.resize(width, height);

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
}

const center = camera.center;
const scale = camera.scale;
const cs = Math.SQRT1_2;
const points = [
  { x: 0, y: 0 }, { x: 105, y: 0 },
  { x: 105, y: 68 }, { x: 0, y: 68 },
  { x: 43.25, y: 51.5 }
];
for (const point of points) {
  const projected = camera.project(point);
  const expectedX = width / 2 + cs * scale * ((point.x - center.x) - (point.y - center.y));
  const expectedY = height / 2 + cs * 0.38 * scale * ((point.x - center.x) + (point.y - center.y));
  close(projected.x, expectedX, 1e-7, "projected X matches renderer affine transform");
  close(projected.y, expectedY, 1e-7, "projected Y matches renderer affine transform");
  const restored = camera.unproject(projected);
  close(restored.x, point.x, 1e-7, "isometric X round trip");
  close(restored.y, point.y, 1e-7, "isometric Y round trip");
}

camera.zoomBy(1.5);
const zoomed = camera.project({ x: 24, y: 17 });
const zoomedBack = camera.unproject(zoomed);
close(zoomedBack.x, 24, 1e-7, "zoomed X round trip");
close(zoomedBack.y, 17, 1e-7, "zoomed Y round trip");

camera.setMode("tactical");
const tactical = camera.project({ x: 30, y: 55 });
const tacticalBack = camera.unproject(tactical);
close(tacticalBack.x, 30, 1e-7, "tactical X round trip");
close(tacticalBack.y, 55, 1e-7, "tactical Y round trip");

camera.setMode("follow", "ball");
camera.update({ ball: { id: "ball", position: { x: 79, y: 41 } } }, 0.1);
const followCenter = camera.project(camera.center);
close(followCenter.x, width / 2, 1e-7, "follow center stays centered horizontally");
close(followCenter.y, height / 2, 1e-7, "follow center stays centered vertically");
const followPoint = camera.unproject({ x: width * 0.63, y: height * 0.37 });
const followRoundTrip = camera.project(followPoint);
close(followRoundTrip.x, width * 0.63, 1e-7, "follow X round trip uses current center");
close(followRoundTrip.y, height * 0.37, 1e-7, "follow Y round trip uses current center");

console.log("camera projection and renderer alignment checks passed");
