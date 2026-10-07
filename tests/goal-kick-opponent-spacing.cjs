const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/physics.js');
require('../src/rules.js');

const TF = globalThis.TF;
const centerY = 34;
function place(player, x, y, vx = 0.7, vy = -0.2) {
  player.position = { x, y, z: 0 };
  player.previousPosition = { ...player.position };
  player.velocity.x = vx; player.velocity.y = vy;
}
function ownPenaltyContains(team, pitch, p) {
  const dir = team.attackDirection;
  const depth = dir > 0 ? p.x : pitch.length - p.x;
  return depth <= 16.5 + 1e-6 && Math.abs(p.y - pitch.width / 2) <= 20.16 + 1e-6;
}
function fixture(seed, restartSide) {
  const match = TF.createMatch({ seed, halfSeconds: 120 });
  TF.rulesLab.configure(match, { autoRestartSeconds: 0, addedTimeSeconds: 0 });
  match.state.phase = 'open-play';
  const restartTeam = match.teams.find(team => team.side === restartSide);
  const rival = match.teams.find(team => team.id !== restartTeam.id);
  const dir = restartTeam.attackDirection;
  const point = { x: dir > 0 ? 5.5 : match.pitch.length - 5.5, y: centerY };
  const restartKeeper = restartTeam.activePlayers.find(player => player.isGoalkeeper);
  place(restartKeeper, point.x, point.y, 0, 0);
  restartTeam.activePlayers.filter(player => player !== restartKeeper).forEach((player, i) => place(player, 45 + i, 8 + i, 0.4, 0.1));

  const rivals = rival.activePlayers.filter(player => !player.isGoalkeeper);
  const ownGoalX = dir > 0 ? 0 : match.pitch.length;
  const depthExiter = rivals[0], widthExiter = rivals[1], distant = rivals[2], otherEnd = rivals[3], sidelineOut = rivals[4];
  place(depthExiter, ownGoalX + dir * 10, centerY, 1.2, 0.4);
  place(widthExiter, ownGoalX + dir * 10, centerY + 19, -0.8, 0.3);
  place(distant, dir > 0 ? 63 : 42, 8, 0.2, -0.1);
  place(otherEnd, dir > 0 ? 94 : 11, centerY, -0.3, 0.15);
  place(sidelineOut, ownGoalX + dir * 10, 61, 0.6, 0.2);
  const rivalKeeper = rival.activePlayers.find(player => player.isGoalkeeper);
  const rivalOwnGoalX = rival.attackDirection > 0 ? 0 : match.pitch.length;
  place(rivalKeeper, rivalOwnGoalX + rival.attackDirection * 4, centerY, -0.5, 0.4);
  return { match, restartTeam, rival, restartKeeper, rivalKeeper, dir, ownGoalX, point, depthExiter, widthExiter, distant, otherEnd, sidelineOut };
}
function start(state) {
  const { match, restartTeam, point } = state;
  TF.rulesLab.awardRestart(match, 'goal-kick', restartTeam.id, point, 'goal-kick-spacing-test');
  TF.updateRules(match, TF.FIXED_DT);
  assert.equal(match.state.phase, 'open-play', 'zero-delay goal kick did not enter play');
  assert.equal(match.state.restartInProgress.type, 'goal-kick');
}
function unchanged(player, before, label) {
  assert.deepEqual(player.position, before.position, `${label} was moved despite already being legal/exempt`);
  assert.deepEqual(player.previousPosition, before.previousPosition, `${label} previousPosition was rewritten`);
  assert.equal(player.velocity.x, before.vx, `${label} horizontal velocity was erased`);
  assert.equal(player.velocity.y, before.vy, `${label} vertical velocity was erased`);
}

for (const side of ['home', 'away']) {
  const s = fixture(side === 'home' ? 63001 : 63002, side);
  const legalSnapshots = [s.distant, s.otherEnd, s.sidelineOut, s.rivalKeeper].map(player => ({
    player, position: { ...player.position }, previousPosition: { ...player.previousPosition },
    vx: player.velocity.x, vy: player.velocity.y,
  }));
  start(s);

  assert.equal(ownPenaltyContains(s.restartTeam, s.match.pitch, s.depthExiter.position), false,
    `${side} goal kick left an opposing outfielder inside the restart team's penalty area`);
  assert.ok(Math.abs(s.depthExiter.position.x - (s.ownGoalX + s.dir * 16.55)) < 1e-6,
    `${side} penalty-area depth exit was not the minimal legal displacement`);
  assert.equal(s.depthExiter.position.y, centerY);
  assert.equal(s.depthExiter.velocity.x, 0, 'the repositioned opponent retained stale horizontal velocity');

  assert.equal(ownPenaltyContains(s.restartTeam, s.match.pitch, s.widthExiter.position), false,
    `${side} goal kick left a near-boundary opponent inside the restart team's penalty area`);
  assert.equal(s.widthExiter.position.x, s.ownGoalX + s.dir * 10,
    `${side} nearer lateral exit unnecessarily changed the player's depth`);
  assert.ok(Math.abs(s.widthExiter.position.y - (centerY + 20.21)) < 1e-6,
    `${side} opponent did not take the nearest lateral exit`);

  for (const snap of legalSnapshots) unchanged(snap.player, snap, `${side} legal opponent`);
  assert.ok(Math.abs((s.point.x - s.restartKeeper.position.x) * s.dir - 0.55) < 1e-6,
    `${side} taker must stand behind the ball for a physical goal-kick contact`);
  assert.deepEqual(s.match.ball.position, { x: s.point.x, y: s.point.y, z: 0.11 }, `${side} goal-kick ball moved before physical release`);
  assert.ok(s.match.events.some(event => event.type === 'restart-ready' && event.restartType === 'goal-kick'),
    `${side} goal kick readiness was not recorded`);
  assert.equal(s.match.events.some(event => event.type === 'restart-taken' && event.restartType === 'goal-kick'), false,
    `${side} goal kick was reported taken before physical release`);

  // A rival goalkeeper normally stays near the opposite goal and is already
  // legal; if actually caught inside this penalty area, the goalkeeper follows
  // the same nearest-boundary law as every other opponent.
  const illegalKeeper = fixture(side === 'home' ? 63011 : 63012, side);
  place(illegalKeeper.rivalKeeper, illegalKeeper.ownGoalX + illegalKeeper.dir * 10, centerY, -0.5, 0.4);
  start(illegalKeeper);
  assert.equal(ownPenaltyContains(illegalKeeper.restartTeam, illegalKeeper.match.pitch, illegalKeeper.rivalKeeper.position), false,
    `${side} illegal rival goalkeeper remained inside the goal-kick penalty area`);
  assert.ok(Math.abs(illegalKeeper.rivalKeeper.position.x - (illegalKeeper.ownGoalX + illegalKeeper.dir * 16.55)) < 1e-6,
    `${side} rival goalkeeper did not take the nearest penalty-area exit`);
  assert.equal(illegalKeeper.rivalKeeper.position.y, centerY);
}

process.stdout.write('goal-kick opponents leave only the restart team’s penalty area by the nearest boundary\n');
