const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/analysis.js');
require('../src/world.js');
const TF = globalThis.TF;

const match = TF.createMatch({ seed: 118001, halfSeconds: 90, matchId: 'shared-analysis' });
match.players.forEach((p, i) => {
  p.position = { x: 3 + (i * 17) % 99, y: 2 + (i * 23) % 64, z: 0 };
});
const checkpointHash = TF.hashCheckpoint(TF.captureCheckpoint(match));
const cache = TF.analysis.rebuild(match);
assert.ok(cache, 'analysis builds its spatial index');
assert.equal(TF.analysis.stats(match).activePlayers, 22);
assert.equal(TF.hashCheckpoint(TF.captureCheckpoint(match)), checkpointHash, 'derived cache never enters checkpointed simulation state');

const reused = [];
for (const point of [{ x: 52.5, y: 34 }, { x: 0, y: 0 }, { x: 105, y: 68 }]) {
  for (const radius of [1.3, 3, 5, 14]) {
    const got = TF.analysis.fillNearby(match, point, radius, reused, null, 'home');
    const expected = match.players.filter(p => p.active && p.teamId !== 'home' &&
      Math.hypot(p.position.x - point.x, p.position.y - point.y) <= radius);
    assert.strictEqual(got, reused, 'caller-owned result buffer is reused');
    assert.deepEqual(got.map(p => p.id), expected.map(p => p.id),
      `spatial query matches brute force at ${point.x},${point.y},r=${radius}`);
  }
}

function pressureBrute(subject, radius) {
  return match.players.filter(p => p.active && p.teamId !== subject.teamId)
    .reduce((sum, p) => {
      const d = Math.hypot(p.position.x - subject.position.x, p.position.y - subject.position.y);
      return sum + (d < radius ? (radius - d) / radius : 0);
    }, 0);
}
for (const subject of match.players) for (const radius of [1.3, 2.5, 3, 5]) {
  assert.ok(Math.abs(TF.analysis.pressureAtPlayer(match, subject, radius) - pressureBrute(subject, radius)) < 1e-9,
    `cached pressure exactly matches brute force for ${subject.id}, r=${radius}`);
}

const observer = match.playersById['home-p09'];
const hiddenOpponent = match.playersById['away-p09'];
observer.beliefState = { entities: {
  'away-p10': { id: 'away-p10', teamId: 'away', position: { x: 52, y: 34 }, estimatedPosition: { x: 54, y: 35 }, confidence: 0.7 }
} };
const beliefPoint = { x: 52, y: 34 }, before = TF.analysis.pressureFromBeliefs(observer, beliefPoint, 5);
const expectedBeliefPressure = ((5 - Math.sqrt(5)) / 5) * 0.7;
assert.ok(Math.abs(before - expectedBeliefPressure) < 1e-9, 'belief pressure prefers the predicted estimated position');
hiddenOpponent.position = { x: 52, y: 34 };
const afterHiddenMove = TF.analysis.pressureFromBeliefs(observer, beliefPoint, 5);
assert.equal(afterHiddenMove, before, 'observer pressure is invariant to hidden opponent world motion');
TF.analysis.rebuild(match);
assert.notEqual(TF.analysis.pressureAt(match, 'home', beliefPoint, 5), before,
  'truth geometry is a separate physics/diagnostic API, not observer knowledge');

const saved = TF.captureCheckpoint(match), priorTruth = TF.analysis.pressureAtPlayer(match, observer, 5);
hiddenOpponent.position = { x: observer.position.x, y: observer.position.y };
match.tick++;
assert.ok(TF.analysis.pressureAtPlayer(match, observer, 5) > priorTruth, 'tick change rebuilds position index before querying');
TF.restoreCheckpoint(match, saved);
assert.ok(Math.abs(TF.analysis.pressureAtPlayer(match, observer, 5) - priorTruth) < 1e-9,
  'restore invalidates derived spatial and pressure caches before re-use');

process.stdout.write('shared analysis checks passed (spatial hash, reusable output, cached pressure, checkpoint isolation, hidden-opponent invariance)\n');
