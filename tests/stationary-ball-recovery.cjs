'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
for (const file of ['core', 'analysis', 'world', 'tactics', 'intelligence', 'physics', 'rules', 'telemetry']) {
  require(`../src/${file}.js`);
}
const TF = globalThis.TF;
const dt = TF.FIXED_DT;
const checkpointPath = path.resolve(__dirname, 'fixtures/stationary-ball-open-play-v2.json');
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < String(text).length; i += 1) {
    value ^= String(text).charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function restoreStall() {
  const match = TF.createMatch({
    seed: checkpoint.seed,
    matchId: checkpoint.id,
    homeFormation: checkpoint.teams[0].formation,
    awayFormation: checkpoint.teams[1].formation,
  });
  TF.restoreCheckpoint(match, checkpoint);
  return match;
}

function nextNoScanTick(match, player) {
  const interval = TF.getPerceptionScanInterval(player, match);
  const phase = hash(player.id) % interval;
  let tick = match.tick + 1;
  while ((tick + phase) % interval === 0) tick += 1;
  return tick;
}

function scheduleOnly(match, actors) {
  const tick = Math.max(...actors.map((actor) => nextNoScanTick(match, actor)));
  match.tick = tick;
  for (const player of match.players) {
    player.ai = player.ai || {};
    player.ai.nextDecision = 999999999;
  }
  for (const actor of actors) actor.ai.nextDecision = tick;
  return tick;
}

function controlledRangeFixture(distance = 27) {
  const match = TF.createMatch({ seed: 912, matchId: `stationary-range-${distance}`, homeFormation: '4-3-3', awayFormation: '4-3-3' });
  const home = match.teams.find((team) => team.side === 'home');
  const away = match.teams.find((team) => team.side === 'away');
  const ballPoint = { x: 52, y: 34 };
  const actor = home.activePlayers.find((p) => p.positionFamily === 'MID' && !p.isGoalkeeper);
  const teammate = home.activePlayers.find((p) => p !== actor && !p.isGoalkeeper);
  for (const [index, player] of home.activePlayers.entries()) {
    player.position = player === actor ? { x: ballPoint.x - distance, y: ballPoint.y, z: 0 }
      : player === teammate ? { x: ballPoint.x - distance - 5, y: ballPoint.y, z: 0 }
        : { x: 4 + index, y: 4 + index * 3, z: 0 };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.facing = { x: 1, y: 0 };
  }
  for (const [index, player] of away.activePlayers.entries()) {
    player.position = { x: 3 + index, y: 5 + index * 3, z: 0 };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.facing = { x: 1, y: 0 };
  }
  match.ball.position = { ...ballPoint, z: 0.11 };
  match.ball.velocity = { x: 0, y: 0, z: 0 };
  match.ball.ownerId = null;
  for (const observer of [actor, teammate]) {
    const entities = {};
    for (const mate of home.activePlayers) {
      if (mate === observer) continue;
      entities[mate.id] = {
        id: mate.id, teamId: home.id,
        position: { x: mate.position.x, y: mate.position.y },
        estimatedPosition: { x: mate.position.x, y: mate.position.y },
        velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, confidence: 0.92,
        baseConfidence: 0.92, observedTick: 0, ageTicks: 1, source: 'vision',
      };
    }
    observer.beliefState = {
      entities, updatedTick: 0, lastScanTick: 0, observations: [],
      ball: {
        position: { ...ballPoint, z: 0.11 }, estimatedPosition: { ...ballPoint },
        velocity: { x: 0, y: 0, z: 0 }, estimatedZ: 0.11, estimatedVelocityZ: 0,
        confidence: 0.92, baseConfidence: 0.92, observedTick: 0, ageTicks: 1, ownerId: null,
      },
    };
  }
  match.tick = 2;
  return { match, actor, teammate, home, away, ballPoint };
}

function evaluate(match, actors) {
  const tick = scheduleOnly(match, actors);
  TF.updateAI(match, dt);
  return { tick, candidates: actors.map((actor) => actor.ai.decisionExplanation.candidates) };
}

function stationaryCandidate(player) {
  return player.ai && player.ai.decisionExplanation && player.ai.decisionExplanation.candidates
    .find((candidate) => candidate.details && candidate.details.stationaryLooseBall);
}

// Reproduce the real open-play checkpoint and ensure both sides use a local
// claim rank instead of sending all 22 active players toward the settled ball.
const live = restoreStall();
assert.equal(live.tick, 174493);
assert.equal(live.state.period, 2);
assert.equal(live.state.halfTime, false);
assert.equal(live.state.finished, false);
assert.equal(live.state.phase, 'open-play');
assert.equal(live.state.restartInProgress, null);
assert.equal(live.ball.ownerId, null);
assert.ok(Math.hypot(live.ball.velocity.x, live.ball.velocity.y) < 0.01);
const core = TF.createCore({ match: live, renderSnapshots: false });
const maxClaimants = { home: 0, away: 0 };
let firstRealControl = null;
for (let i = 0; i < 900; i += 1) {
  core.step(1);
  for (const team of live.teams) {
    const claimants = team.activePlayers.filter((player) => stationaryCandidate(player));
    maxClaimants[team.side] = Math.max(maxClaimants[team.side], claimants.length);
  }
  const controlEvent = live.events.slice(checkpoint.events.length).find((event) => event.type === 'ball-control');
  if (controlEvent) {
    firstRealControl = controlEvent;
    break;
  }
}
assert.ok(firstRealControl, 'ordinary suffix did not produce a real ball-control event');
assert.equal(firstRealControl.playerId, 'away-p11', 'the observed closest away runner should make the physical collection');
assert.ok(firstRealControl.tick - checkpoint.tick <= 900, 'physical pickup exceeded the bounded suffix');
assert.ok(maxClaimants.home > 0 && maxClaimants.away > 0, 'both teams should recognize a genuinely contestable loose ball');
assert.ok(maxClaimants.home <= 2 && maxClaimants.away <= 2, 'a whole team must not pursue the ball; at most a close arrival tie may contest');

// A fully observed 27m ball is within the ordinary 42m vision horizon. The
// nearest claimant wins the team race, while the second observed runner yields.
const range = controlledRangeFixture(27);
evaluate(range.match, [range.actor, range.teammate]);
const nearestClaim = stationaryCandidate(range.actor);
const trailingClaim = stationaryCandidate(range.teammate);
assert.ok(nearestClaim, 'a fresh, visible stationary ball 27m away was ignored');
assert.equal(nearestClaim.details.contestRank, 1);
assert.equal(nearestClaim.details.observedContestants, 2);
assert.equal(trailingClaim, undefined, 'the clearly slower observed teammate should retain shape');

// A fresh local GK location closer to the ball must not reserve it: keepers
// retain their independent hold/sweep behavior and are not participants in the
// outfield claimant set.
const goalkeeperNearer = controlledRangeFixture(27);
const observedGoalkeeper = goalkeeperNearer.home.activePlayers.find((player) => player.isGoalkeeper);
observedGoalkeeper.position = { x: goalkeeperNearer.ballPoint.x - 12, y: goalkeeperNearer.ballPoint.y, z: 0 };
const keeperEntity = goalkeeperNearer.actor.beliefState.entities[observedGoalkeeper.id];
Object.assign(keeperEntity, {
  position: { x: observedGoalkeeper.position.x, y: observedGoalkeeper.position.y },
  estimatedPosition: { x: observedGoalkeeper.position.x, y: observedGoalkeeper.position.y },
  velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, role: 'GK',
  positionFamily: 'GK', isGoalkeeper: true, confidence: 0.96, ageTicks: 1,
});
evaluate(goalkeeperNearer.match, [goalkeeperNearer.actor]);
assert.ok(stationaryCandidate(goalkeeperNearer.actor), 'a nearer non-pursuing goalkeeper incorrectly reserved the ball');

// Stale, uncertain, airborne, and materially rising ball memories do not enter
// the settled-ball path. No world-state coordinates are read to refresh them.
for (const [negativeIndex, change] of [
  (ball) => { ball.ageTicks = 25; ball.observedTick = -24; },
  (ball) => { ball.confidence = 0.61; ball.baseConfidence = 0.61; },
  (ball) => { ball.estimatedZ = 0.5; ball.position.z = 0.5; },
  (ball) => { ball.estimatedVelocityZ = 1.8; ball.velocity.z = 1.8; },
  (ball) => { ball.estimatedZ = null; ball.position.z = undefined; },
  (ball) => { ball.estimatedVelocityZ = null; ball.velocity.z = undefined; },
  (ball) => { ball.velocity.x = undefined; },
].entries()) {
  const fixture = controlledRangeFixture(27);
  change(fixture.actor.beliefState.ball);
  evaluate(fixture.match, [fixture.actor]);
  assert.equal(stationaryCandidate(fixture.actor), undefined, `negative control ${negativeIndex} created a stationary pursuit: ${JSON.stringify(fixture.actor.beliefState.ball)}`);
}

// A moving flight stays with the existing flight/intercept logic, not the new
// stationary-ball candidate type.
const movingFlight = controlledRangeFixture(27);
movingFlight.actor.beliefState.ball.velocity.x = 8;
evaluate(movingFlight.match, [movingFlight.actor]);
assert.equal(stationaryCandidate(movingFlight.actor), undefined, 'a moving flight entered the settled-ball candidate path');

// The actual observation radius is 42m; a fresh reading 37m away must still
// create a claimant. Only beyond the direct-visibility envelope is rejected.
const visibleFarBall = controlledRangeFixture(37);
evaluate(visibleFarBall.match, [visibleFarBall.actor]);
assert.ok(stationaryCandidate(visibleFarBall.actor), 'a fresh visible stationary ball 37m away was ignored');
const outside = controlledRangeFixture(43);
evaluate(outside.match, [outside.actor]);
assert.equal(stationaryCandidate(outside.actor), undefined, 'the settled-ball response exceeded its bounded visible-ball envelope');

// Goalkeepers retain their separate hold/save/sweep logic, even when their
// local ball reading is grounded and 27m away.
const keeperCase = controlledRangeFixture(27);
const keeper = keeperCase.home.activePlayers.find((player) => player.isGoalkeeper);
keeper.position = { x: keeperCase.ballPoint.x - 27, y: keeperCase.ballPoint.y, z: 0 };
keeper.beliefState = JSON.parse(JSON.stringify(keeperCase.actor.beliefState));
keeper.beliefState.entities = {};
evaluate(keeperCase.match, [keeper]);
assert.equal(stationaryCandidate(keeper), undefined, 'the goalkeeper entered the outfield settled-ball pursuit path');

// A local decision stays invariant when only hidden physical truth changes.
const visibleWorld = controlledRangeFixture(27);
const hiddenWorld = controlledRangeFixture(27);
hiddenWorld.match.ball.position = { x: 99, y: 7, z: 0.11 };
hiddenWorld.match.ball.ownerId = hiddenWorld.away.activePlayers[0].id;
for (const mate of hiddenWorld.home.activePlayers) {
  if (mate !== hiddenWorld.actor) mate.position = { x: 99, y: 7, z: 0 };
}
evaluate(visibleWorld.match, [visibleWorld.actor]);
evaluate(hiddenWorld.match, [hiddenWorld.actor]);
assert.deepEqual(stationaryCandidate(hiddenWorld.actor), stationaryCandidate(visibleWorld.actor),
  'unseen live ball/teammate state changed the settled-ball claim decision');

// The old valid v2 checkpoint suffix has no owner/control/restart for12s; this
// regression's real control is the causal before/after distinction. The v1
// halftime checkpoint is intentionally not used because it cannot reproduce
// an open-play second-half suffix.
process.stdout.write(`stationary-ball recovery passed: tick ${checkpoint.tick} -> ${firstRealControl.tick} (${((firstRealControl.tick - checkpoint.tick) * dt).toFixed(2)}s), ${firstRealControl.playerId}; max claimants ${maxClaimants.home}/${maxClaimants.away}; observed 27m claimant rank ${nearestClaim.details.contestRank}/${nearestClaim.details.observedContestants}\n`);
