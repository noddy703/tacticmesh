'use strict';
const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');

const TF = globalThis.TF;
const clone = value => JSON.parse(JSON.stringify(value));
const mirrorX = (x, direction) => direction > 0 ? x : 105 - x;
const defenderPoints = [
  [39, 15], [61, 15], [65, 19], [72, 50], [78, 15],
  [80, 60], [55, 20], [80, 30], [65, 60], [30, 40]
];

function makeWorld(direction) {
  const match = TF.createMatch({ seed: 77881, homeFormation: '4-3-3', awayFormation: '4-4-2' });
  const home = match.teams.find(team => team.id === 'home');
  const away = match.teams.find(team => team.id === 'away');
  const player = (team, role) => team.activePlayers.find(entry => entry.role === role);
  const carrier = player(home, 'RW');
  const runner = player(home, 'ST');
  const keeper = player(away, 'GK');
  home.attackDirection = direction;
  away.attackDirection = -direction;
  match.state.phase = 'open-play';
  match.state.restartType = null;
  match.state.restartTeamId = null;
  match.state.restartStarted = null;
  match.state.possessionTeamId = home.id;
  // Keep uninterrupted and restored empty-event cursors canonical.
  match._eventTick = null;
  match._eventTickCount = 0;

  function place(p, x, y, facing, hold = true) {
    const actualX = mirrorX(x, direction);
    p.position.x = actualX; p.position.y = y;
    p.previousPosition.x = actualX; p.previousPosition.y = y;
    p.velocity = { x: 0, y: 0, z: 0 };
    p.facing = facing || { x: direction, y: 0 };
    p.formationSlot = Object.assign({}, p.formationSlot, { x, y });
    p.ai = { nextDecision: 99999, lastDecision: 0, lastScanTick: -99 };
    p.intent = hold ? { type: 'hold', action: 'hold', target: { x: actualX, y }, desiredSpeed: 0,
      createdTick: 0, expiresTick: 99999, commitUntilTick: 99999, utility: 1, teamIdAtCreation: p.teamId } : null;
    p.motor = hold ? { type: 'hold', target: { x: actualX, y }, desiredSpeed: 0,
      createdTick: 0, expiresTick: 99999, commitUntilTick: 99999 } : null;
  }

  place(carrier, 45, 8, { x: direction, y: 0 });
  carrier.hasBall = true;
  place(runner, 50, 4, { x: 0, y: 1 });
  // Formation slots are stored in attack-direction coordinates.
  runner.formationSlot = Object.assign({}, runner.formationSlot, { x: 74, y: 20 });
  // This profile makes the normal run score meaningfully competitive with
  // support choices; no synchronized-run utility bonus is introduced.
  runner.attributes.teamwork = 0;
  place(keeper, 104, 34, null, false);
  away.activePlayers.filter(p => p !== keeper).forEach((p, index) => place(p, ...defenderPoints[index], undefined, false));

  match.ball.ownerId = carrier.id;
  match.ball.position = { x: mirrorX(45, direction) + direction * 0.35, y: 8, z: 0.11 };
  match.ball.velocity = { x: 0, y: 0, z: 0 };
  match.ball.controlState = 'controlled';
  match.ball.handControl = false;
  carrier.intent = { type: 'hold', action: 'hold', target: { x: carrier.position.x, y: 8 }, desiredSpeed: 0,
    createdTick: 0, expiresTick: 99999, commitUntilTick: 99999, utility: 1, teamIdAtCreation: home.id };
  runner.ai.nextDecision = 7;
  runner.beliefState = null;
  const core = TF.createCore({ match, seed: match.seed, paused: false });
  return { match, core, home, away, carrier, runner, keeper };
}

function runTo(world, tick) {
  while (world.match.tick < tick) world.core.step(1);
  assert.equal(world.match.tick, tick, 'the normal fixed-step core advances exactly one tick');
}
function makeRestored(checkpoint, direction) {
  const world = makeWorld(direction);
  TF.restoreCheckpoint(world.match, clone(checkpoint));
  return world;
}
function runDecision(checkpoint, direction, mutate) {
  const world = makeRestored(checkpoint, direction);
  if (mutate) mutate(world);
  const from = world.match.tick;
  runTo(world, from + 1);
  return world;
}
function selectedPurpose(world) { return world.runner.intent && world.runner.intent.details && world.runner.intent.details.purpose; }
function hasSynchronizedCandidate(world) {
  return (world.runner.ai.decisionExplanation.candidates || []).some(candidate => candidate.details && candidate.details.purpose === 'observed-carrier-lane-run');
}
function firstDiff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return { path, a, b };
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const diff = firstDiff(a[key], b[key], path ? `${path}.${key}` : key);
    if (diff) return diff;
  }
  return null;
}

// Both observations are produced by ordinary core scans at ticks 1 and 6.
// The fixture holds the rest of the scene still so the decision at tick 7
// isolates run selection while movement and physics remain natural.
const positives = [];
for (const direction of [1, -1]) {
  const world = makeWorld(direction);
  runTo(world, 1);
  const oneSampleCheckpoint = TF.captureCheckpoint(world.match);
  assert.equal(world.runner.beliefState.observedSameOwner && world.runner.beliefState.observedSameOwner.sampleCount, 1,
    'the first ordinary scan records a local same-owner sample');
  runTo(world, 6);
  const local = world.runner.beliefState;
  assert.equal(local.observedSameOwner.sampleCount, 2);
  assert.equal(local.observedSameOwner.lastObservedTick, local.ball.observedTick);
  assert.equal(local.observedSameOwner.lastObservedTick, local.entities[world.carrier.id].observedTick);
  assert.equal(local.observedSameOwner.ownerId, world.carrier.id);
  const before = TF.captureCheckpoint(world.match);
  const beforeEvents = clone(world.match.events);
  const beforePosition = { x: world.runner.position.x, y: world.runner.position.y };
  runTo(world, 7);

  const candidates = world.runner.ai.decisionExplanation.candidates;
  const synced = candidates.find(candidate => candidate.details && candidate.details.purpose === 'observed-carrier-lane-run');
  const ordinary = candidates.find(candidate => candidate.details && candidate.details.purpose === 'run-behind');
  assert.ok(synced, 'fresh repeated owner observations create the synchronized movement option');
  assert.ok(ordinary, 'the existing run-behind option remains available');
  assert.equal(selectedPurpose(world), 'observed-carrier-lane-run', 'existing utility selects the safer onside lane without a new bonus');
  assert.ok(synced.utility > ordinary.utility);
  assert.ok(synced.details.offsideRisk < ordinary.details.offsideRisk,
    'the selected ray intersection is onside while the ordinary endpoint carries offside risk');
  assert.ok(synced.details.laneInterceptionRisk <= 0.001);
  const target = world.runner.intent.target;
  const moved = { x: world.runner.position.x - beforePosition.x, y: world.runner.position.y - beforePosition.y };
  const toward = { x: target.x - beforePosition.x, y: target.y - beforePosition.y };
  assert.ok(moved.x * toward.x + moved.y * toward.y > 0.00001,
    'the selected synchronized destination produces ordinary physical movement');
  positives.push({ world, oneSampleCheckpoint, before, beforeEvents, end: TF.captureCheckpoint(world.match), endEvents: clone(world.match.events) });
}

// A restored one-sample checkpoint follows the same two ordinary scans,
// decision, movement and events as the uninterrupted twin.
for (const positive of positives) {
  const restored = makeRestored(positive.oneSampleCheckpoint, positive.world.home.attackDirection);
  runTo(restored, 7);
  const suffixDiff = firstDiff(TF.captureCheckpoint(restored.match), positive.end);
  assert.equal(suffixDiff, null, `restored scan/movement suffix must match full state: ${JSON.stringify(suffixDiff)}`);
  assert.equal(JSON.stringify(restored.match.events), JSON.stringify(positive.endEvents));
}

// Malformed carried history cannot inherit a second sample merely because
// the next scan is fresh; the old DTO sample ticks must validate first.
{
  const world = makeWorld(1);
  runTo(world, 1);
  world.runner.beliefState.observedSameOwner.lastObservedTick = 0;
  const malformedPrior = TF.captureCheckpoint(world.match);
  const restored = makeRestored(malformedPrior, 1);
  runTo(restored, 7);
  assert.equal(restored.runner.beliefState.observedSameOwner.sampleCount, 1,
    'a prior history tick that disagrees with the captured ball/carrier sample resets the span');
  assert.equal(hasSynchronizedCandidate(restored), false);
}

// One valid sample, a disappeared/missing local owner DTO, uncertain or stale
// observations, and a mismatched current history tick all keep the legacy
// movement choices and never manufacture the synchronized option.
{
  const oneSample = makeWorld(1);
  runTo(oneSample, 1);
  oneSample.runner.ai.nextDecision = 2;
  runTo(oneSample, 2);
  assert.equal(hasSynchronizedCandidate(oneSample), false);
}
const decisionCheckpoint = positives[0].before;
for (const [label, mutate] of [
  ['missing carrier DTO', world => { delete world.runner.beliefState.entities[world.carrier.id]; }],
  ['low-confidence carrier DTO', world => {
    world.runner.beliefState.entities[world.carrier.id].baseConfidence = 0.4;
    world.runner.beliefState.entities[world.carrier.id].confidence = 0.4;
  }],
  ['stale carrier DTO', world => {
    const belief = world.runner.beliefState;
    belief.entities[world.carrier.id].observedTick = -20;
    belief.ball.observedTick = -20;
    belief.observedSameOwner.firstObservedTick = -25;
    belief.observedSameOwner.lastObservedTick = -20;
  }],
  ['mismatched history sample tick', world => { world.runner.beliefState.observedSameOwner.lastObservedTick -= 1; }]
]) {
  const result = runDecision(decisionCheckpoint, 1, mutate);
  if (label === 'stale carrier DTO') {
    assert.ok(result.runner.beliefState.entities[result.carrier.id].ageTicks > 18,
      'stale carrier remains stale after normal age recomputation');
    assert.ok(result.runner.beliefState.ball.ageTicks > 18,
      'stale ball remains stale after normal age recomputation');
  }
  assert.equal(hasSynchronizedCandidate(result), false, `${label} cannot authorize a coordinated run`);
}

// A prior-sample gap or failed current observation clears the span.
{
  const world = makeWorld(1);
  runTo(world, 1);
  world.match.ball.position.x = 2;
  world.match.ball.position.y = 60;
  world.runner.ai.nextDecision = 7;
  runTo(world, 6);
  assert.equal(world.runner.beliefState.observedSameOwner, null,
    'a normal scan without a visible ball clears observed-owner history');
}

// A normal scan that sees an opponent as the owner resets the same-team span.
{
  const world = makeWorld(1);
  runTo(world, 1);
  assert.equal(world.runner.beliefState.observedSameOwner.sampleCount, 1);
  const opposingOwner = world.away.activePlayers.find(p => p !== world.keeper);
  opposingOwner.position.x = 46; opposingOwner.position.y = 8;
  opposingOwner.previousPosition.x = 46; opposingOwner.previousPosition.y = 8;
  opposingOwner.velocity = { x: 0, y: 0, z: 0 };
  opposingOwner.intent = { type: 'hold', action: 'hold', target: { x: 46, y: 8 }, desiredSpeed: 0,
    createdTick: 0, expiresTick: 99999, commitUntilTick: 99999, utility: 1, teamIdAtCreation: world.away.id };
  opposingOwner.motor = { type: 'hold', target: { x: 46, y: 8 }, desiredSpeed: 0,
    createdTick: 0, expiresTick: 99999, commitUntilTick: 99999 };
  world.match.ball.ownerId = opposingOwner.id;
  world.match.ball.position = { x: 46.2, y: 8, z: 0.11 };
  world.match.ball.velocity = { x: 0, y: 0, z: 0 };
  world.match.ball.controlState = 'controlled';
  runTo(world, 6);
  assert.equal(world.runner.beliefState.ball.ownerId, opposingOwner.id,
    'the reset follows a locally perceived opponent owner');
  assert.equal(world.runner.beliefState.observedSameOwner, null,
    'opponent ownership cannot continue the same-team observation span');
}

// If the carrier faces away from the runner segment, there is no forward-ray
// intersection, so baseline movement remains the only run option.
{
  const result = runDecision(decisionCheckpoint, 1, world => {
    const owner = world.runner.beliefState.entities[world.carrier.id];
    owner.facing = { x: -1, y: 0 };
  });
  assert.equal(hasSynchronizedCandidate(result), false);
}

// Local defensive attention at the proposed lane removes the synchronized
// option while leaving ordinary run/support choices available.
{
  const blocked = runDecision(decisionCheckpoint, 1, world => {
    const defender = world.away.activePlayers.find(p => p !== world.keeper);
    const dto = world.runner.beliefState.entities[defender.id];
    assert.ok(dto, 'the runner has a locally observed defender for this control');
    dto.position = { x: 53, y: 8 };
    dto.estimatedPosition = { x: 53, y: 8 };
    dto.velocity = { x: 0, y: 0 };
    dto.confidence = 0.98;
    dto.baseConfidence = 0.98;
    dto.ageTicks = 0;
  });
  assert.equal(hasSynchronizedCandidate(blocked), false,
    'a locally observed defender occupying the synchronized lane blocks that candidate');
  assert.ok((blocked.runner.ai.decisionExplanation.candidates || []).some(candidate =>
    candidate.details && candidate.details.purpose === 'run-behind'),
  'baseline run choices remain available when the lane candidate is blocked');
}

// Opponent physical motion/facing changes cannot alter the choice when the
// observer's local opponent/owner DTOs are fixed and no scan runs at tick 7.
{
  const baseline = runDecision(decisionCheckpoint, 1);
  const hiddenTwin = runDecision(decisionCheckpoint, 1, world => {
    world.carrier.velocity = { x: -30, y: 20, z: 0 };
    world.carrier.facing = { x: -1, y: 0 };
  });
  assert.equal(hiddenTwin.runner.beliefState.entities[hiddenTwin.carrier.id].observedTick,
    baseline.runner.beliefState.entities[baseline.carrier.id].observedTick);
  assert.equal(JSON.stringify(hiddenTwin.runner.beliefState.entities), JSON.stringify(baseline.runner.beliefState.entities));
  assert.equal(selectedPurpose(hiddenTwin), selectedPurpose(baseline));
  assert.equal(JSON.stringify(hiddenTwin.runner.ai.decisionExplanation.candidates), JSON.stringify(baseline.runner.ai.decisionExplanation.candidates));
}

process.stdout.write('observed run-pass synchronization: PASS (mirrored natural scans, utility selection, movement, history integrity, freshness and hidden-world controls)\n');
