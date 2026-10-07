const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
require('../src/telemetry.js');
const TF = globalThis.TF;

function match(seed) {
  const m = TF.createMatch({ seed, halfSeconds: 120, matchId: `auditor-${seed}` });
  m.teams[0].activePlayers.forEach((p, i) => { p.position.x = 8 + (i % 5) * 17; p.position.y = 4 + (i % 4) * 19; p.facing = { x: 1, y: 0 }; });
  m.teams[1].activePlayers.forEach((p, i) => { p.position.x = 97 - (i % 5) * 17; p.position.y = 5 + (i % 4) * 19; p.facing = { x: -1, y: 0 }; });
  return m;
}
function sample(m, tick) {
  m.tick = tick; m.clock.elapsedSeconds = tick * TF.FIXED_DT;
  TF.updateTelemetry(m, TF.FIXED_DT);
}
function expectWarning(m, warning, expected) {
  const report = TF.telemetry.audit(m);
  assert.equal(report.warnings.includes(warning), expected, `${warning} detector ${expected ? 'failed to flag' : 'false-flagged'}; report=${JSON.stringify(report)}`);
  return report;
}

// Positive control: a spaced team shape, no ownership, no press or threat stays clean.
const positive = match(97001);
sample(positive, 60);
assert.deepEqual(TF.telemetry.audit(positive).warnings, []);

// Formation collapse: five players crowd the same small patch.
const cluster = match(97002), home = cluster.teams[0];
home.activePlayers.filter(p => !p.isGoalkeeper).slice(0, 5).forEach((p, i) => { p.position.x = 40 + i * .5; p.position.y = 33 + (i % 2) * .5; });
sample(cluster, 60);
expectWarning(cluster, 'formation-collapse', true);

// Chase-ball and press-suicide use separate conditions: a pile of chasers, and a pressing line with no central cover.
const chase = match(97003), carrier = chase.teams[1].activePlayers[9];
carrier.position = { x: 50, y: 34, z: 0 }; chase.ball.ownerId = carrier.id; chase.ball.position = { x: 50, y: 34, z: .11 };
const chasers = chase.teams[0].activePlayers.filter(p => !p.isGoalkeeper).slice(0, 4);
chasers.forEach((p, i) => { p.position = { x: 43 + i, y: 32 + i, z: 0 }; p.intent = { type: 'press', target: { x: 50, y: 34 } }; });
sample(chase, 60);
expectWarning(chase, 'chase-ball', true);

const suicide = match(97004), pressTarget = suicide.teams[1].activePlayers[9];
pressTarget.position = { x: 50, y: 34, z: 0 }; suicide.ball.ownerId = pressTarget.id; suicide.ball.position = { x: 50, y: 34, z: .11 };
const pressers = suicide.teams[0].activePlayers.filter(p => !p.isGoalkeeper).slice(0, 2);
pressers.forEach((p, i) => { p.position = { x: 48 + i, y: 18 + i * 28, z: 0 }; p.intent = { type: 'press', target: { x: 50, y: 34 } }; });
// Leave the rest of the defending side outside the central cover corridor.
suicide.teams[0].activePlayers.filter(p => !p.isGoalkeeper && !pressers.includes(p)).forEach((p, i) => { p.position = { x: i % 2 ? 6 : 42, y: i % 2 ? 4 : 64, z: 0 }; });
sample(suicide, 60);
expectWarning(suicide, 'press-suicide', true);
expectWarning(suicide, 'chase-ball', false);

// Static support requires three consecutive one-second windows of failed support options while a teammate owns the ball.
const staticSupport = match(97005), possessor = staticSupport.teams[0].activePlayers[5];
possessor.position = { x: 48, y: 34, z: 0 }; staticSupport.ball.ownerId = possessor.id; staticSupport.ball.position = { x: 48, y: 34, z: .11 };
staticSupport.teams[0].activePlayers.filter(p => p !== possessor && !p.isGoalkeeper).slice(0, 4).forEach(p => { p.intent = { type: 'support', target: { x: 48, y: 34 } }; });
sample(staticSupport, 60); sample(staticSupport, 120); sample(staticSupport, 180);
expectWarning(staticSupport, 'static-support', true);

// Offside runs compare an attacker with the live second-last defender and the ball, mirrored by attack direction.
const offside = match(97006), attackingTeam = offside.teams[0], defending = offside.teams[1];
offside.ball.position = { x: 42, y: 34, z: .11 };
defending.activePlayers.filter(p => !p.isGoalkeeper).forEach(p => { p.position.x = 72; });
attackingTeam.activePlayers.filter(p => p.positionFamily === 'FWD').forEach(p => { p.position.x = 91; });
sample(offside, 60);
expectWarning(offside, 'offside-run', true);

// Keeper freeze requires a sustained, on-frame loose-ball trajectory and no keeper response.
const freeze = match(97007), keeper = freeze.teams[0].activePlayers.find(p => p.isGoalkeeper);
keeper.position = { x: 3, y: 34, z: 0 };
freeze.ball.ownerId = null; freeze.ball.position = { x: 12, y: 34, z: .11 }; freeze.ball.velocity = { x: -3, y: 0, z: 0 };
sample(freeze, 60); sample(freeze, 120); sample(freeze, 180);
expectWarning(freeze, 'goalkeeper-freeze', true);

// Rotation chatter needs repeated material target changes and accumulated heading churn while the player barely relocates.
const chatter = match(97008), chatterPlayer = chatter.teams[0].activePlayers[6];
for (let i = 0; i < 7; i++) {
  const angle = (i + 1) * .4; chatterPlayer.facing = { x: Math.cos(angle), y: Math.sin(angle) };
  chatterPlayer.ai = { selected: { type: 'move', utility: .5 } };
  chatterPlayer.intent = { type: 'move', target: { x: i % 2 ? 65 : 25, y: i % 2 ? 55 : 12 } };
  sample(chatter, 5 + i * 10);
}
sample(chatter, 75);
expectWarning(chatter, 'rotation-chatter', true);

// Pass-loop uses completed teammate receptions, not intended targets or repeated incomplete attempts.
const loop = match(97009), a = loop.teams[0].activePlayers[5], b = loop.teams[0].activePlayers[6];
let tick = 1;
function ev(data) { loop.tick = tick; TF.appendEvent(loop, Object.assign({ tick: tick, time: tick * TF.FIXED_DT }, data)); TF.updateTelemetry(loop, TF.FIXED_DT); tick++; }
for (let i = 0; i < 8; i++) {
  const from = i % 2 ? b : a, to = i % 2 ? a : b;
  ev({ type: 'pass', teamId: from.teamId, playerId: from.id, targetId: to.id, origin: { x: 40, y: 34 }, target: { x: 41, y: 34 } });
  ev({ type: 'ball-control', teamId: to.teamId, playerId: to.id, origin: { x: 41, y: 34 }, contactPoint: { x: 41, y: 34 } });
}
expectWarning(loop, 'pass-loop', true);

process.stdout.write('behavior auditor passed: eight detectors trigger on controlled failures and positive control stays clear\n');
