const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/analysis.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
require('../src/telemetry.js');
const fs = require('node:fs');
const path = require('node:path');
const TF = globalThis.TF;

function setup(type, side, point, seed) {
  const match = TF.createMatch({ seed, halfSeconds: 120, matchId: `restart-readiness-${seed}` });
  TF.rulesLab.configure(match, { autoRestartSeconds: 0, addedTimeSeconds: 0 });
  match.state.phase = 'open-play';
  const team = match.teams.find(candidate => candidate.side === side);
  TF.rulesLab.awardRestart(match, type, team.id, point, 'restart-readiness-test');
  TF.updateRules(match, TF.FIXED_DT);
  assert.equal(match.state.restartInProgress.type, type, `${type} should remain pending after setup`);
  assert.equal(match.events.filter(event => event.type === 'restart-ready').length, 1);
  assert.equal(match.events.filter(event => event.type === 'restart-taken').length, 0,
    'setup must not be reported as a physical restart');
  return { match, team, taker: match.playersById[match.state.restartInProgress.takerId] };
}
function naturalRelease(type, side, point, seed, maxTicks = 240) {
  const state = setup(type, side, point, seed);
  const core = TF.createCore({ match: state.match, renderSnapshots: false });
  const originalConfirm = TF.confirmRestartPhysicalRelease;
  let throwEntry = null;
  TF.confirmRestartPhysicalRelease = function (match, takerId, kind, enteredField) {
    if (type === 'throw-in' && kind === 'throw' && enteredField) {
      throwEntry = { tick: match.tick, position: { ...match.ball.position }, velocity: { ...match.ball.velocity } };
    }
    return originalConfirm(match, takerId, kind, enteredField);
  };
  let ticks = 0;
  try {
    while (!state.match.events.some(event => event.type === 'restart-taken' && event.restartType === type) && ticks < maxTicks) {
      core.step(1); ticks += 1;
    }
  } finally {
    TF.confirmRestartPhysicalRelease = originalConfirm;
  }
  const releases = state.match.events.filter(event => event.type === 'restart-taken' && event.restartType === type);
  assert.equal(releases.length, 1, `${type} must have exactly one physical release event`);
  assert.ok(ticks < maxTicks, `${type} never released through the natural AI/motor path`);
  const ready = state.match.events.find(event => event.type === 'restart-ready');
  const taken = releases[0];
  const played = state.match.events.find(event => event.type === 'ball-played' && event.playerId === ready.takerId);
  assert.ok(played, `${type} release must come from a real physical ball-played event`);
  const launch = state.match.events.find(event => event.tick === played.tick && event.playerId === ready.takerId
    && ['pass', 'shot', 'throw-in'].includes(event.type));
  assert.ok(launch, `${type} release includes the executed physical action event`);
  if (type !== 'throw-in') assert.equal(played.tick, taken.tick, `${type} release and restart-taken must resolve in one physical tick`);
  else assert.ok(taken.tick >= played.tick, 'throw is not taken before its physical release');
  assert.ok(played.sequence < taken.sequence, 'kick event must precede restart-taken');
  assert.equal(taken.takerId, ready.takerId);
  assert.equal(taken.restartSequence, ready.restartSequence);
  assert.equal(state.match.state.restartInProgress, null);
  if (type !== 'throw-in') {
    const dx = launch.target.x - played.contactPoint.x, dy = launch.target.y - played.contactPoint.y;
    const length = Math.hypot(dx, dy) || 1;
    const gapX = played.contactPoint.x - played.origin.x, gapY = played.contactPoint.y - played.origin.y;
    const gap = Math.hypot(gapX, gapY);
    assert.ok(gap <= 1.15, `${type} physical release stays within ordinary kick reach`);
    if (gap > 0.35) assert.ok((gapX * dx + gapY * dy) / (gap * length) >= 0.78,
      `${type} taker approaches from behind the actual legal target ray`);
  }
  return { ...state, core, ticks, played, launch, taken, throwEntry };
}
function physicalThrowBeforeEntry(seed, target) {
  const state = setup('throw-in', 'home', { x: 52, y: 0 }, seed);
  const intent = { type: 'throw', action: 'throw', target, ballTarget: target, desiredSpeed: 0.8, power: 0.72,
    createdTick: state.match.tick + 1, expiresTick: state.match.tick + 180, committed: false, _physicsDone: false };
  state.taker.intent = state.taker.motor = intent;
  state.match.tick += 1;
  TF.updatePhysics(state.match, TF.FIXED_DT);
  TF.updateRules(state.match, TF.FIXED_DT);
  return state;
}
function physicalKickToTarget(state, target, action = 'pass', maxTicks = 240) {
  const taker = state.taker;
  const intent = { type: action, action, target, ballTarget: target, desiredSpeed: 0.62,
    power: 0.72, lift: 0.08, createdTick: state.match.tick + 1,
    expiresTick: state.match.tick + maxTicks, committed: false, _physicsDone: false,
    details: { restartApproach: { sequence: Number(state.match.state.restartSequence) || 0 } } };
  taker.intent = taker.motor = taker.currentAction = intent;
  for (let tick = 0; tick < maxTicks && !state.match.events.some(event => event.type === 'restart-taken'); tick += 1) {
    state.match.tick += 1;
    TF.updatePhysics(state.match, TF.FIXED_DT);
    TF.updateRules(state.match, TF.FIXED_DT);
  }
  const release = state.match.events.find(event => event.type === 'restart-taken');
  const played = state.match.events.find(event => event.type === 'ball-played' && event.playerId === taker.id);
  const launch = played && state.match.events.find(event => event.tick === played.tick && event.playerId === taker.id
    && ['pass', 'shot'].includes(event.type));
  assert.ok(release && played && launch, `${state.match.state.restartType || 'restart'} should release through the ordinary motor toward ${JSON.stringify(target)}`);
  const dx = launch.target.x - played.contactPoint.x, dy = launch.target.y - played.contactPoint.y;
  const len = Math.hypot(dx, dy) || 1, ox = played.contactPoint.x - played.origin.x, oy = played.contactPoint.y - played.origin.y;
  const gap = Math.hypot(ox, oy);
  assert.ok(gap <= 1.15, 'release remains within normal kick contact range');
  if (gap > 0.35) assert.ok((ox * dx + oy * dy) / (gap * len) >= 0.78, 'release follows the unchanged forward-foot gate');
  return { release, played, launch, ticks: state.match.tick - intent.createdTick + 1 };
}

// The exact frozen c0a99 stall checkpoint now continues through a real AI and
// motor decision. Capture midway through that ordinary approach and verify
// uninterrupted and restored suffixes stay deterministic.
{
  const savedStall = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/restart-stalled-kickoff-c0a99-v3.json'), 'utf8'));
  assert.equal(savedStall.tick, 1868);
  assert.equal(savedStall.state.restartInProgress.type, 'kickoff');
  const match = TF.createMatch({ seed: savedStall.seed, matchId: savedStall.id });
  TF.restoreCheckpoint(match, savedStall);
  const originalTaker = match.playersById[savedStall.state.restartInProgress.takerId];
  const setupPosition = { ...originalTaker.position };
  const firstCore = TF.createCore({ match, renderSnapshots: false });
  for (let tick = 0; tick < 7; tick += 1) firstCore.step(1);
  assert.ok(Math.hypot(originalTaker.position.x - setupPosition.x, originalTaker.position.y - setupPosition.y) > 0.02,
    'the designated taker physically leaves the fixed initial stance during approach');
  assert.ok(match.state.restartInProgress, 'the ball remains dead at its legal mark during approach');
  assert.deepEqual({ x: match.ball.position.x, y: match.ball.position.y }, savedStall.state.restartInProgress.point);
  const approachSave = TF.captureCheckpoint(match);
  const resumed = TF.createMatch({ seed: match.seed, matchId: match.id });
  TF.restoreCheckpoint(resumed, approachSave);
  const resumedCore = TF.createCore({ match: resumed, renderSnapshots: false });
  for (let tick = 0; tick < 150 && !match.events.some(event => event.type === 'restart-taken'); tick += 1) firstCore.step(1);
  for (let tick = 0; tick < 150 && !resumed.events.some(event => event.type === 'restart-taken'); tick += 1) resumedCore.step(1);
  const matchRelease = match.events.find(event => event.type === 'restart-taken' && event.restartType === 'kickoff');
  const resumedRelease = resumed.events.find(event => event.type === 'restart-taken' && event.restartType === 'kickoff');
  assert.ok(matchRelease && resumedRelease, 'both suffixes physically release the stalled kickoff');
  assert.deepEqual(resumed.events, match.events, 'mid-approach checkpoint continuation preserves release/event chronology');
  assert.deepEqual(TF.captureCheckpoint(resumed), TF.captureCheckpoint(match), 'mid-approach checkpoint continuation preserves full state');
  assert.ok(matchRelease.tick - savedStall.tick <= 150, 'the original stalled kickoff releases within the bounded suffix');
}

// Controlled legal rays verify that the ordinary stance motor supports a
// backward, lateral, or forward kickoff on either end without narrowing AI
// choices or weakening physical contact gates.
{
  const rays = [
    ['home', { x: 60.5, y: 36 }], ['home', { x: 44.5, y: 36 }], ['home', { x: 52.5, y: 42 }],
    ['away', { x: 44.5, y: 32 }], ['away', { x: 60.5, y: 32 }], ['away', { x: 52.5, y: 26 }]
  ];
  rays.forEach(([side, target], index) => {
    const test = setup('kickoff', side, { x: 52.5, y: 34 }, 981500 + index);
    // Keep this controlled contact-geometry fixture clear of incidental
    // kickoff teammate touches; normal play's full-roster spacing is covered
    // separately by the exact restored AI/motor checkpoint above.
    test.match.players.forEach((player, playerIndex) => {
      if (player.id === test.taker.id) return;
      const x = player.teamId === test.team.id ? 16 : 89;
      const y = 5 + (playerIndex % 6) * 11;
      player.position = player.previousPosition = { x, y, z: 0 };
      player.velocity.x = player.velocity.y = 0;
    });
    const movementAtStart = { ...test.taker.position };
    const result = physicalKickToTarget(test, target);
    assert.ok(Math.hypot(test.taker.position.x - movementAtStart.x, test.taker.position.y - movementAtStart.y) > 0.05,
      `${side} kickoff target ${index} uses finite motor movement before contact`);
    assert.equal(result.release.restartType, 'kickoff');
  });
}

// Goal kicks need a real foot approach on both ends of the pitch. The taker
// stands 0.55m behind the mark so the ordinary motor can contact the ball.
const homeGoalKick = naturalRelease('goal-kick', 'home', { x: 5.5, y: 34 }, 981001);
const awayGoalKick = naturalRelease('goal-kick', 'away', { x: 99.5, y: 34 }, 981002);
assert.equal(homeGoalKick.played.kind, 'pass');
assert.equal(awayGoalKick.played.kind, 'pass');
assert.ok(homeGoalKick.taker.position.x < homeGoalKick.taken.point.x);
assert.ok(awayGoalKick.taker.position.x > awayGoalKick.taken.point.x);

// Both touchlines use an actual overhead throw from the line. The taker and
// release point use the line as the center-position proxy; the ball must enter
// the field before rules publish restart-taken.
for (const [index, y] of [0, 68].entries()) {
  const thrown = naturalRelease('throw-in', 'home', { x: 52, y }, 981010 + index);
  assert.equal(thrown.played.kind, 'throw');
  assert.equal(thrown.played.contactPoint.y, y);
  assert.ok(thrown.played.contactPoint.z >= 1.8, 'throw begins at overhead height');
  assert.equal(thrown.match.events.filter(event => event.type === 'throw-in').length, 1);
  assert.ok(thrown.throwEntry, 'restart-taken follows an observed physical throw entering the pitch');
  assert.equal(thrown.throwEntry.tick, thrown.taken.tick);
  assert.ok(thrown.played.contactPoint.z >= 1.8, 'the physical release began overhead');
  const radius = Number(thrown.match.ball.radius) || 0.11;
  assert.ok(thrown.throwEntry.position.y >= radius && thrown.throwEntry.position.y <= thrown.match.pitch.width - radius,
  'the whole ball is inside the pitch at the release-confirmation point');
  assert.equal(thrown.taker.position.y, y, 'thrower center remains on the touchline line proxy');
}

// A shallow, fieldward physical throw can be checkpointed while the ball is
// airborne but has not entered. Resuming confirms it only when the whole ball
// clears the touchline. AI-selected legal throws above cover the natural path;
// this motor fixture exercises the delayed-entry law boundary deterministically.
{
  let pending = null;
  for (let seed = 981015; seed < 981080 && !pending; seed += 1) {
    const attempt = physicalThrowBeforeEntry(seed, { x: 68, y: 2 });
    if (attempt.match.state.restartReleaseThisTick && attempt.match.state.restartReleaseThisTick.awaitingFieldEntry
      && attempt.match.ball.velocity.y > 1.4) pending = attempt;
  }
  assert.ok(pending, 'a seeded shallow throw has a physical inward trajectory that has not entered yet');
  assert.ok(pending.match.events.some(event => event.type === 'ball-played' && event.kind === 'throw'));
  assert.equal(pending.match.state.restartReleaseThisTick.awaitingFieldEntry, true);
  assert.equal(pending.match.events.some(event => event.type === 'restart-taken'), false);
  const saved = TF.captureCheckpoint(pending.match);
  const resumed = TF.createMatch({ seed: pending.match.seed, halfSeconds: 120, matchId: pending.match.id });
  TF.restoreCheckpoint(resumed, saved);
  assert.equal(resumed.state.restartReleaseThisTick.awaitingFieldEntry, true);
  const rival = resumed.teams.find(team => team.id !== pending.team.id).activePlayers[4];
  rival.position.x = rival.previousPosition.x = resumed.ball.position.x;
  rival.position.y = rival.previousPosition.y = resumed.ball.position.y;
  rival.velocity.x = rival.velocity.y = 0;
  rival.intent = rival.motor = { type: 'pass', action: 'pass', target: { x: 68, y: 34 }, ballTarget: { x: 68, y: 34 }, desiredSpeed: 0, power: 0.7, expiresTick: 100 };
  const rivalPassesBefore = resumed.events.filter(event => event.type === 'ball-played' && event.playerId === rival.id).length;
  resumed.tick += 1;
  TF.updatePhysics(resumed, TF.FIXED_DT);
  TF.updateRules(resumed, TF.FIXED_DT);
  assert.equal(resumed.events.filter(event => event.type === 'ball-played' && event.playerId === rival.id).length, rivalPassesBefore,
    'a nearby non-taker cannot act on a throw before field entry');
  const resumedCore = TF.createCore({ match: resumed, renderSnapshots: false });
  for (let tick = 0; tick < 120 && !resumed.events.some(event => event.type === 'restart-taken'); tick += 1) resumedCore.step(1);
  const taken = resumed.events.filter(event => event.type === 'restart-taken' && event.restartType === 'throw-in');
  assert.equal(taken.length, 1, `delayed throw should enter before retake (vy=${pending.match.ball.velocity.y}, tick=${resumed.tick}, last=${resumed.events.slice(-2).map(event => event.type + ':' + event.reason).join(',')})`);
  assert.ok(taken[0].tick > saved.tick, 'throw is confirmed after the saved pre-entry release tick');
}

// A physically mis-aimed throw that leaves the pitch before entering is
// retaken by the same side; it cannot become a goal, opponent restart, or
// player-control event while still outside.
{
  let failedThrow = null;
  for (let seed = 981100; seed < 981150 && !failedThrow; seed += 1) {
    const attempt = physicalThrowBeforeEntry(seed, { x: 68, y: 0.05 });
    if (attempt.match.ball.velocity.y < -0.02) failedThrow = attempt;
  }
  assert.ok(failedThrow, 'seeded execution includes a physical outward throw miss');
  const core = TF.createCore({ match: failedThrow.match, renderSnapshots: false });
  for (let tick = 0; tick < 60 && !failedThrow.match.events.some(event => event.type === 'restart-awarded' && event.reason === 'throw-did-not-enter'); tick += 1) core.step(1);
  assert.ok(failedThrow.match.events.some(event => event.type === 'restart-awarded' && event.restartType === 'throw-in' && event.reason === 'throw-did-not-enter'));
  assert.equal(failedThrow.match.events.some(event => event.type === 'restart-taken'), false);
  assert.equal(failedThrow.match.events.some(event => ['ball-control', 'keeper-collection', 'goal-confirmed'].includes(event.type)), false);
  assert.equal(failedThrow.match.events.some(event => event.type === 'restart-awarded' && ['goal-line', 'touchline'].includes(event.reason)), false,
    'an unentered throw cannot become a live-ball boundary restart');
}

// A shallow throw that remains in the touchline strip until it lands is a
// retake even if it still has horizontal speed; it cannot roll into play after
// first touching the ground outside.
{
  let shallow = null;
  for (let seed = 981200; seed < 981500 && !shallow; seed += 1) {
    const attempt = physicalThrowBeforeEntry(seed, { x: 68, y: 0.05 });
    const release = attempt.match.state.restartReleaseThisTick;
    if (release && release.awaitingFieldEntry && attempt.match.ball.velocity.y > 0
      && attempt.match.ball.velocity.y < 0.16 && attempt.match.ball.velocity.x > 5) shallow = attempt;
  }
  assert.ok(shallow, 'seeded shallow throw remains airborne and moving outside at release');
  const core = TF.createCore({ match: shallow.match, renderSnapshots: false });
  for (let tick = 0; tick < 100 && !shallow.match.events.some(event => event.type === 'restart-awarded' && event.reason === 'throw-did-not-enter'); tick += 1) core.step(1);
  assert.ok(shallow.match.events.some(event => event.type === 'restart-awarded' && event.restartType === 'throw-in' && event.reason === 'throw-did-not-enter'));
  assert.equal(shallow.match.events.some(event => event.type === 'restart-taken'), false);
  assert.equal(shallow.match.events.some(event => ['ball-control', 'keeper-collection', 'goal-confirmed'].includes(event.type)), false);
}

// All four corner geometry combinations complete a real target-aligned kick,
// including marks at the edge of the pitch.
for (const [index, corner] of [
  ['home', { x: 105, y: 0 }], ['home', { x: 105, y: 68 }],
  ['away', { x: 0, y: 0 }], ['away', { x: 0, y: 68 }]
].entries()) {
  const result = naturalRelease('corner', corner[0], corner[1], 981020 + index);
  assert.equal(result.played.type, 'ball-played');
}

naturalRelease('direct-free-kick', 'home', { x: 35, y: 31 }, 981030);
naturalRelease('indirect-free-kick', 'away', { x: 70, y: 42 }, 981031);
naturalRelease('kickoff', 'home', { x: 52.5, y: 34 }, 981032);
const penalty = naturalRelease('penalty', 'home', { x: 94, y: 34 }, 981033);
assert.equal(penalty.played.kind, 'shoot', 'a penalty restart is released only through the shot motor');
assert.ok(penalty.match.events.some(event => event.type === 'shot' && event.playerId === penalty.taken.takerId));

// Carrying is not a legal release. The pending mark survives repeated ordinary
// physics ticks even when the designated kicker has a stale carry motor.
const carried = setup('goal-kick', 'home', { x: 5.5, y: 34 }, 981040);
carried.taker.intent = carried.taker.motor = { type: 'carry', action: 'carry', target: { x: 22, y: 34 }, desiredSpeed: 0.8, expiresTick: 100 };
for (let tick = 0; tick < 24; tick += 1) {
  carried.match.tick += 1;
  TF.updatePhysics(carried.match, TF.FIXED_DT);
  assert.ok(carried.match.state.restartInProgress, 'a carry touch cannot end restart readiness');
  TF.updateRules(carried.match, TF.FIXED_DT);
}
assert.equal(carried.match.events.filter(event => event.type === 'restart-taken').length, 0);
assert.equal(carried.match.events.some(event => event.type === 'ball-played'), false);

// A throw-in cannot be taken by a foot pass, and a penalty cannot be taken by
// a pass. Both stay pending until their prescribed physical action occurs.
for (const [type, seed, point] of [
  ['throw-in', 981041, { x: 52, y: 0 }],
  ['penalty', 981042, { x: 94, y: 34 }]
]) {
  const invalid = setup(type, 'home', point, seed);
  invalid.taker.intent = invalid.taker.motor = { type: 'pass', action: 'pass', target: { x: 66, y: 34 }, ballTarget: { x: 66, y: 34 }, desiredSpeed: 0, power: 0.7, expiresTick: 100 };
  invalid.match.tick += 1;
  TF.updatePhysics(invalid.match, TF.FIXED_DT);
  TF.updateRules(invalid.match, TF.FIXED_DT);
  assert.ok(invalid.match.state.restartInProgress, `${type} rejects a foot pass`);
  assert.equal(invalid.match.events.some(event => event.type === 'ball-played'), false);
  assert.equal(invalid.match.events.some(event => event.type === 'restart-taken'), false);
}

// A goalkeeper's ordinary hand distribution is still a pass event/stat, not a
// touchline throw-in. This path has no pending restart and uses the existing
// physical distribution motor.
{
  const match = TF.createMatch({ seed: 981045, halfSeconds: 120, matchId: 'keeper-hand-distribution' });
  const keeper = match.players.find(player => player.isGoalkeeper && player.teamId === match.teams[0].id);
  match.ball.ownerId = keeper.id;
  match.ball.handControl = true;
  match.ball.controlState = 'keeper-held';
  match.ball.position.z = 0.68;
  keeper.intent = keeper.motor = { type: 'throw', action: 'throw', target: { x: 34, y: 24 }, ballTarget: { x: 34, y: 24 }, power: 0.65, expiresTick: 120 };
  match.tick += 1;
  TF.updatePhysics(match, TF.FIXED_DT);
  const distribution = match.events.find(event => event.type === 'pass' && event.playerId === keeper.id);
  assert.ok(distribution, 'keeper hand distribution retains pass event semantics');
  assert.equal(match.events.some(event => event.type === 'throw-in' && event.playerId === keeper.id), false);
  assert.equal(keeper.stats.passes, 1);
  assert.equal(match.telemetry.passes, 1);
  assert.equal(match.events.some(event => event.type === 'restart-taken'), false);
}

// The release marker is part of checkpoints and the physical-touch hook. A
// taker's next actual touch is recorded for the IFK rule; another player's
// intervening contact clears the restriction.
const secondTouch = naturalRelease('kickoff', 'home', { x: 52.5, y: 34 }, 981032);
const kickMarker = secondTouch.match.state.restartSecondTouch;
assert.ok(kickMarker && kickMarker.takerId === secondTouch.taken.takerId);
const checkpoint = TF.captureCheckpoint(secondTouch.match);
assert.deepEqual(checkpoint.state.restartSecondTouch, kickMarker);
const resumed = TF.createMatch({ seed: secondTouch.match.seed, halfSeconds: 120, matchId: secondTouch.match.id });
TF.restoreCheckpoint(resumed, checkpoint);
assert.deepEqual(resumed.state.restartSecondTouch, kickMarker);
resumed.tick += 1;
TF.physicsHelpers.addTouch(resumed, resumed.playersById[kickMarker.takerId], 'control');
TF.updateRules(resumed, TF.FIXED_DT);
assert.ok(resumed.events.some(event => event.type === 'restart-awarded' && event.restartType === 'indirect-free-kick' && event.reason === 'restart-second-touch'));

const cleared = naturalRelease('kickoff', 'home', { x: 52.5, y: 34 }, 981032);
const clearMarker = cleared.match.state.restartSecondTouch;
const teammate = cleared.team.activePlayers.find(player => player.id !== clearMarker.takerId);
cleared.match.tick += 1;
TF.physicsHelpers.addTouch(cleared.match, teammate, 'control');
assert.equal(cleared.match.state.restartSecondTouch, null, 'an intervening teammate control ends the taker restriction');
TF.updateRules(cleared.match, TF.FIXED_DT);
assert.equal(cleared.match.events.some(event => event.type === 'restart-awarded' && event.reason === 'restart-second-touch'), false);

// The restart-only target-ray alignment does not narrow or reorient an
// ordinary backward pass in open play.
{
  const match = TF.createMatch({ seed: 981540, halfSeconds: 120, matchId: 'open-play-backward-pass-control' });
  const kicker = match.playersById['home-p08'];
  match.state.phase = 'open-play';
  match.players.forEach((player, index) => {
    player.intent = player.motor = player.currentAction = null;
    const point = { x: 8 + (index % 10) * 9, y: 5 + Math.floor(index / 10) * 18, z: 0 };
    player.position = player.previousPosition = point;
    player.velocity.x = player.velocity.y = 0;
  });
  kicker.position = kicker.previousPosition = { x: 50, y: 34, z: 0 };
  kicker.facing = { x: -1, y: 0 };
  const target = { x: 38, y: 34 };
  match.ball.ownerId = kicker.id;
  match.ball.handControl = false;
  match.ball.position = match.ball.previousPosition = { x: 49.45, y: 34, z: 0.11 };
  match.ball.velocity.x = match.ball.velocity.y = match.ball.velocity.z = 0;
  kicker.intent = kicker.motor = kicker.currentAction = { type: 'pass', action: 'pass', target, ballTarget: target,
    desiredSpeed: 0, power: 0.65, expiresTick: 60, details: {} };
  match.tick += 1;
  TF.updatePhysics(match, TF.FIXED_DT);
  assert.ok(match.events.some(event => event.type === 'pass' && event.playerId === kicker.id),
    'a physically aligned backward pass remains legal in ordinary open play');
  assert.equal(match.events.some(event => event.type === 'restart-taken'), false);
}

console.log('Restart readiness, physical release geometry, legal action constraints, checkpointed second-touch marker, and physical touch handling passed.');
