'use strict';

const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/analysis.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
const TF = globalThis.TF;

function fixture(seed) {
  const match = TF.createMatch({ seed, halfSeconds: 120 });
  const side = match.teams[0], taker = side.activePlayers.find(p => !p.isGoalkeeper);
  const point = { x: 50, y: 34 };
  match.state.phase = 'open-play';
  match.state.possessionTeamId = side.id;
  match.state.restartInProgress = { type: 'direct-free-kick', teamId: side.id, takerId: taker.id, point: { ...point } };
  match.ball.position = { x: point.x, y: point.y, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity = { x: 0, y: 0, z: 0 };
  match.ball.ownerId = taker.id;
  match.ball.controlState = 'controlled';
  match.ball.handControl = false;
  match.ball.lastTouchPlayerId = null;
  match.ball.lastTouchTeamId = null;
  match.ball.lastTouchKind = 'restart';
  match.ball._lastRestartType = 'direct-free-kick';
  match.players.forEach((p, i) => {
    p.motor = p.intent = p.currentAction = null;
    p.position.x = i === match.players.indexOf(taker) ? point.x - 0.35 : (i < 11 ? 10 + i * 2 : 90 - (i - 11) * 2);
    p.position.y = i === match.players.indexOf(taker) ? point.y : 8 + (i % 8) * 7;
    p.previousPosition = { ...p.position };
    p.velocity.x = p.velocity.y = 0;
  });
  taker.position.x = point.x - 0.35;
  taker.position.y = point.y;
  taker.previousPosition = { ...taker.position };
  taker.facing = { x: 1, y: 0 };
  return { match, side, taker, point };
}

function physicalRestartRelease(f) {
  const target = { x: 68, y: 34 };
  const dx = target.x - f.point.x, dy = target.y - f.point.y;
  const length = Math.hypot(dx, dy) || 1;
  const direction = { x: dx / length, y: dy / length };
  f.taker.position = {
    x: f.point.x - direction.x * 0.55,
    y: f.point.y - direction.y * 0.55,
    z: 0
  };
  f.taker.previousPosition = { ...f.taker.position };
  f.taker.velocity.x = f.taker.velocity.y = 0;
  f.taker.facing = direction;
  f.taker.motor = f.taker.intent = {
    type: 'pass', action: 'pass', target, ballTarget: target,
    desiredSpeed: 0, power: 0.35, lift: 0, expiresTick: 50
  };
}

// Before the designated taker releases the ball, another player's stale tackle
// action cannot play the dead ball, create a live foul, or replace its restart.
const notTaken = fixture(77101), defender = notTaken.match.teams[1].activePlayers[5];
defender.position = { x: notTaken.point.x + 0.7, y: notTaken.point.y, z: 0 };
defender.previousPosition = { ...defender.position };
defender.facing = { x: -1, y: 0 };
defender.rng = { next: () => 0 };
defender.motor = defender.intent = {
  type: 'slide', action: 'slide', target: { ...notTaken.point }, desiredSpeed: 0, expiresTick: 50
};
TF.updatePhysics(notTaken.match, TF.FIXED_DT);
TF.updateRules(notTaken.match, TF.FIXED_DT);
assert.ok(notTaken.match.state.restartInProgress, 'untaken restart remains pending');
assert.equal(notTaken.match.state.restartInProgress.takerId, notTaken.taker.id);
assert.ok(!notTaken.match.events.some(e => ['tackle', 'contact', 'restart-awarded'].includes(e.type)),
  'pre-release stale action cannot generate a live-ball challenge/foul/restart');

// A genuine release event is synchronously recorded, then an actual opponent
// tackle on the released ball remains eligible in that same physics tick.
const sameTick = fixture(77102), chaser = sameTick.match.teams[1].activePlayers[5];
chaser.position = { x: sameTick.point.x + 0.75, y: sameTick.point.y, z: 0 };
chaser.previousPosition = { ...chaser.position };
chaser.facing = { x: -1, y: 0 };
chaser.rng = { next: () => 0 };
chaser.motor = chaser.intent = {
  type: 'tackle', action: 'tackle', target: { ...sameTick.point }, desiredSpeed: 0, expiresTick: 50
};
physicalRestartRelease(sameTick);
sameTick.match.tick = 1;
TF.updatePhysics(sameTick.match, TF.FIXED_DT);
const taken = sameTick.match.events.find(e => e.type === 'restart-taken' && e.takerId === sameTick.taker.id);
const sameTickTackle = sameTick.match.events.find(e => e.type === 'tackle' && e.defenderId === chaser.id && e.tick === sameTick.match.tick);
assert.ok(taken, 'the actual kick emits restart-taken');
assert.ok(sameTickTackle, 'opponent action can physically contest immediately after release');
assert.ok(taken.sequence < sameTickTackle.sequence, 'restart-taken precedes the post-release contact event');
assert.equal(sameTick.match.state.restartInProgress, null, 'a legal kick ends the ready phase before later same-tick actions');
assert.equal(sameTick.match.state.restartSecondTouch, null, 'an intervening player contact clears the one-touch marker');
TF.updateRules(sameTick.match, TF.FIXED_DT);
assert.ok(!sameTick.match.events.some(e => e.type === 'restart-second-touch'),
  'the taker is not penalized after another player has made a real touch');

// With no intervening player touch, the taker's next physical ball contact is
// flagged as the second-touch offence and awards an indirect free kick.
const second = fixture(77103);
physicalRestartRelease(second);
second.match.tick = 1;
TF.updatePhysics(second.match, TF.FIXED_DT);
TF.updateRules(second.match, TF.FIXED_DT);
assert.ok(second.match.state.restartSecondTouch, 'the released kick arms the second-touch marker');
second.taker.motor = second.taker.intent = {
  type: 'tackle', action: 'tackle', target: { ...second.match.ball.position }, desiredSpeed: 0, expiresTick: 50
};
second.taker.rng = { next: () => 0 };
second.match.tick += 1;
TF.updatePhysics(second.match, TF.FIXED_DT);
assert.equal(second.match.state.restartSecondTouch.secondTouchTick, second.match.tick,
  'the taker made a real second contact through the physics action path');
TF.updateRules(second.match, TF.FIXED_DT);
assert.ok(second.match.events.some(e => e.type === 'restart-second-touch'));
assert.equal(second.match.state.restartType, 'indirect-free-kick');
assert.equal(second.match.state.restartTeamId, second.match.teams[1].id);

// The pending-restart guard is scoped: ordinary open-play passing still uses
// the same physical strike path when no restart is active.
const ordinary = TF.createMatch({ seed: 77104, halfSeconds: 120 });
const carrier = ordinary.teams[0].activePlayers[6];
ordinary.state.phase = 'open-play';
ordinary.players.forEach(p => {
  p.motor = p.intent = p.currentAction = null;
  p.velocity.x = p.velocity.y = 0;
});
carrier.position = { x: 50, y: 34, z: 0 };
carrier.previousPosition = { ...carrier.position };
carrier.facing = { x: 1, y: 0 };
ordinary.ball.ownerId = carrier.id;
ordinary.ball.position = { x: 50.43, y: 34, z: 0.11 };
ordinary.ball.previousPosition = { ...ordinary.ball.position };
ordinary.ball.velocity = { x: 0, y: 0, z: 0 };
carrier.motor = carrier.intent = { type: 'pass', action: 'pass', target: { x: 68, y: 34 }, ballTarget: { x: 68, y: 34 }, desiredSpeed: 0, power: 0.5, expiresTick: 50 };
TF.updatePhysics(ordinary, TF.FIXED_DT);
assert.ok(ordinary.events.some(e => e.type === 'pass' && e.playerId === carrier.id),
  'normal open-play pass is unaffected by the pending-restart guard');

process.stdout.write('restart contact-order cases passed (pending guard, immediate contact, intervening touch, second touch, ordinary pass)\n');
