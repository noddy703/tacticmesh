const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
require('../src/telemetry.js');
const TF = globalThis.TF;

// Identical seeds reproduce the same exact fixed-tick state sequence.
const twinA = fresh(3301), twinB = fresh(3301);
const twinCoreA = TF.createCore({ match: twinA, renderSnapshots: false });
const twinCoreB = TF.createCore({ match: twinB, renderSnapshots: false });
for (let i = 0; i < 120; i++) {
  twinCoreA.step(1); twinCoreB.step(1);
  assert.equal(TF.hashCheckpoint(TF.captureCheckpoint(twinA)), TF.hashCheckpoint(TF.captureCheckpoint(twinB)), 'same-seed state diverged at tick ' + i);
}
for (const module of ['core', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) {
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../src', module + '.js'), 'utf8');
  assert.equal(/\bMath\.random\s*\(/.test(source), false, module + ' must not draw unseeded simulation randomness');
}

// Regression: all 22 players make integrated AI decisions on the first kickoff tick.
const first = TF.createCore({ seed: 5701, halfSeconds: 2, renderSnapshots: false });
first.step(1);
assert.equal(first.match.tick, 1);
assert.equal(first.match.players.filter(p => p.active && p.ai && p.ai.selected).length, 22);
assert.ok(first.match.players.every(p => Number.isFinite(p.position.x) && Number.isFinite(p.position.y)));

// The tactical candidate hook must be safe while an actor has no ball observation.
for (const ball of [null, {}, { position: null, velocity: null }]) {
  const got = TF.augmentCandidates([], { self: { position: { x: 20, y: 34 } }, ball, pitch: { length: 105, width: 68 } });
  assert.deepEqual(got, []);
}

// Seeded checkpoint replay covers AI, tactics, physics, rules, and bounded telemetry state.
function fresh(seed) { return TF.createMatch({ seed, halfSeconds: 12, matchId: 'acceptance-' + seed }); }
const continuous = fresh(912), replay = fresh(912);
const coreA = TF.createCore({ match: continuous, renderSnapshots: false });
coreA.step(150);
const checkpoint = TF.captureCheckpoint(continuous);
const coreB = TF.createCore({ match: replay, renderSnapshots: false });
TF.restoreCheckpoint(replay, checkpoint);
for (let i = 0; i < 90; i++) {
  coreA.step(1); coreB.step(1);
  assert.equal(TF.hashCheckpoint(TF.captureCheckpoint(continuous)), TF.hashCheckpoint(TF.captureCheckpoint(replay)), 'checkpoint suffix diverged at suffix tick ' + i);
}

// Half-time transitions must give period two to the side that did not open.
const half = fresh(441);
TF.rulesLab.configure(half, { autoRestartSeconds: 0, addedTimeSeconds: 0 });
const openingTeam = half.state.restartTeamId;
const otherTeam = half.teams.find(t => t.id !== openingTeam);
half.state.phase = 'kickoff';
TF.updateRules(half, TF.FIXED_DT);
assert.equal(half.state.rules.firstKickoffTeamId, openingTeam);
half.clock.period = 2;
half.state.phase = 'kickoff';
half.state.restartTeamId = openingTeam;
TF.updateRules(half, TF.FIXED_DT);
assert.equal(half.state.restartTeamId, otherTeam.id);
assert.equal(half.state.phase, 'open-play');
assert.equal(half.ball.ownerId && half.playersById[half.ball.ownerId].teamId, otherTeam.id);

// Frozen event records remain immutable while event-derived metrics are accumulated.
const metrics = fresh(661), attacker = metrics.teams[0].activePlayers[9], keeper = metrics.teams[1].activePlayers[0];
metrics.state.phase = 'open-play';
metrics.ball.ownerId = attacker.id;
metrics.ball.position = { x: 87, y: 34, z: 0.11 };
attacker.position.x = 87; attacker.position.y = 34;
attacker.intent = { type: 'shoot', action: 'shoot', target: { x: 105, y: 34 }, ballTarget: { x: 105, y: 34 }, power: .7 };
metrics.tick = 4;
TF.updatePhysics(metrics, TF.FIXED_DT);
TF.updateTelemetry(metrics, TF.FIXED_DT);
const stats = TF.telemetry.summary(metrics).teams[attacker.teamId];
assert.equal(stats.shots, 1);
assert.ok(stats.xG > 0 && stats.xG < 1);
assert.ok(Object.isFrozen(metrics.events.find(e => e.type === 'shot')));
assert.ok(TF.telemetry.audit(metrics).warnings instanceof Array);

// The decision trace and periodic auditor ring buffers remain bounded over a longer run.
const bounded = TF.createCore({ seed: 6617, halfSeconds: 30, renderSnapshots: false });
bounded.step(900);
assert.equal(bounded.match.telemetry.debugDecisions.length, 160);
assert.ok(bounded.match.telemetry.auditSamples.length <= 120);

process.stdout.write('acceptance scenarios passed (seeded kickoff, 22-player AI, checkpoint replay, restart assignment, telemetry)\n');
