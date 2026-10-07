'use strict';
const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/analysis.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');
require('../src/telemetry.js');
require('../src/product-data.js');
require('../src/engine-facade.js');

const TF = globalThis.TF;
TF.VERSION = 'press-contact-commitment-test';
const compiled = TF.productData.compilePack(TF.productData.starterPack());
assert.equal(compiled.ok, true, JSON.stringify(compiled.errors));
const [homeTeam, awayTeam] = compiled.teams;
const originalContext = TF.getTacticalContext;

function makeHandle({ defendingSide = 'home', oldType = 'press', oldUtility = 0.72, geometry = 'reachable', ownerConfidence = 0.95, ballConfidence = 0.95, ownerAge = 0, ballAge = 0, recovery = 0, lowTackleSkill = false, hiddenCarrierShift = false, omitOwnerObservation = false } = {}) {
  const handle = TF.engine.createMatch({
    matchId: `press-contact-${defendingSide}-${oldType}-${geometry}-${ownerConfidence}-${ballConfidence}`,
    seed: 70317,
    home: homeTeam,
    away: awayTeam,
  });
  const match = handle.match;
  const defending = match.teams.find(team => team.id.includes(defendingSide));
  const attacking = match.teams.find(team => team !== defending);
  const tackler = defending.activePlayers.find(player => player.positionFamily === 'DEF' && !player.isGoalkeeper);
  const carrier = attacking.activePlayers.find(player => player.positionFamily === 'FWD' && !player.isGoalkeeper)
    || attacking.activePlayers.find(player => player.positionFamily !== 'GK' && !player.isGoalkeeper);
  assert.ok(tackler && carrier, 'fixture requires an outfield defender and opposing carrier');

  const attackDir = Number(attacking.attackDirection) || 1;
  const tacklerX = attackDir > 0 ? 50 : 55;
  const carrierX = tacklerX + attackDir * (geometry === 'blocked' ? 0.8 : 1.2);
  const ballX = geometry === 'blocked' ? tacklerX + attackDir * 1.1 : carrierX - attackDir * 0.4;
  for (const [index, player] of match.players.entries()) {
    const point = { x: 18 + (index % 5) * 3, y: 6 + (index % 10) * 5, z: 0 };
    player.position = { ...point };
    player.previousPosition = { ...point };
    player.velocity = { x: 0, y: 0, z: 0 };
    player.intent = player.motor = player.currentAction = null;
    player.ai = { lastDecision: 100, nextDecision: 100000 };
  }
  tackler.position = { x: tacklerX, y: 34, z: 0 };
  tackler.previousPosition = { ...tackler.position };
  tackler.velocity = { x: 0, y: 0, z: 0 };
  tackler.facing = { x: attackDir, y: 0 };
  if (lowTackleSkill) {
    tackler.attributes.tackling = 1;
    tackler.attributes.discipline = 1;
    tackler.attributes.aggression = 1;
  }
  tackler._challengeRecoveryUntilTick = recovery;
  tackler.ai = { lastDecision: 100, nextDecision: 101 };
  carrier.position = { x: carrierX, y: 34, z: 0 };
  carrier.previousPosition = { ...carrier.position };
  carrier.velocity = { x: 0, y: 0, z: 0 };
  carrier.facing = { x: attackDir, y: 0 };
  carrier.hasBall = true;
  match.ball.ownerId = carrier.id;
  match.ball.position = { x: ballX, y: 34, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity = { x: 0, y: 0, z: 0 };
  match.ball._touchCooldown = 0;
  match.tick = 100;
  match.clock.elapsedSeconds = 100 * TF.FIXED_DT;
  match.clock.periodSeconds = match.clock.elapsedSeconds;
  match.state.phase = 'open-play';
  match.state.restartInProgress = null;
  match.state.halfTime = false;
  match.state.finished = false;

  const entities = {};
  for (const player of match.players) {
    if (player.id === tackler.id) continue;
    entities[player.id] = {
      id: player.id,
      teamId: player.teamId,
      role: player.role,
      position: { x: player.position.x, y: player.position.y },
      estimatedPosition: { x: player.position.x, y: player.position.y },
      velocity: { x: player.velocity.x, y: player.velocity.y },
      facing: { x: player.facing.x, y: player.facing.y },
      confidence: 0.95,
      baseConfidence: 0.95,
      observedTick: match.tick - ownerAge,
      ageTicks: ownerAge,
      source: 'vision',
    };
  }
  const carrierBelief = entities[carrier.id];
  carrierBelief.confidence = ownerConfidence;
  carrierBelief.baseConfidence = ownerConfidence;
  carrierBelief.ageTicks = ownerAge;
  carrierBelief.observedTick = match.tick - ownerAge;
  if (omitOwnerObservation) delete entities[carrier.id];
  tackler.beliefState = {
    updatedTick: match.tick,
    lastScanTick: match.tick,
    observations: [],
    entities,
    ball: {
      position: { ...match.ball.position },
      estimatedPosition: { x: match.ball.position.x, y: match.ball.position.y },
      velocity: { x: 0, y: 0, z: 0 },
      estimatedZ: 0.11,
      estimatedVelocityZ: 0,
      confidence: ballConfidence,
      baseConfidence: ballConfidence,
      observedTick: match.tick - ballAge,
      ageTicks: ballAge,
      ownerId: carrier.id,
      lastTouchTeamId: carrier.teamId,
    },
  };
  const oldTarget = { x: tacklerX + attackDir * 12, y: 34, z: 0 };
  tackler.intent = tackler.motor = {
    type: oldType,
    action: oldType,
    teamIdAtCreation: tackler.teamId,
    target: oldTarget,
    targetId: carrier.id,
    createdTick: 95,
    expiresTick: 120,
    commitUntilTick: 125,
    utility: oldUtility,
    desiredSpeed: 1,
    details: { targetId: carrier.id, responsibility: 'assigned-press', perceived: true },
  };

  if (hiddenCarrierShift) {
    carrier.position = { x: attackDir > 0 ? 91 : 14, y: 61, z: 0 };
    carrier.previousPosition = { ...carrier.position };
    match.ball.position = { x: carrier.position.x - attackDir * 0.4, y: 61, z: 0.11 };
    match.ball.previousPosition = { ...match.ball.position };
  }
  return { handle, match, tackler, carrier, attackDir };
}

function withPressReservation(state, callback) {
  const saved = TF.getTacticalContext;
  TF.getTacticalContext = function (match, player) {
    const context = saved(match, player);
    if (player.id !== state.tackler.id) return context;
    return Object.assign({}, context, {
      responsibilities: Object.assign({}, context.responsibilities || {}, {
        press: true,
        pressTargetId: state.carrier.id,
      }),
    });
  };
  try { return callback(); } finally { TF.getTacticalContext = saved; }
}

function stepDecision(state) {
  return withPressReservation(state, () => TF.engine.stepMatch(state.handle, 1));
}

function decision(state) {
  return state.tackler.ai && state.tackler.ai.decisionExplanation;
}

function decisionTwin(options) {
  const state = makeHandle(options);
  state.tackler.ai.nextDecision = state.match.tick;
  withPressReservation(state, () => TF.updateAI(state.match, TF.FIXED_DT));
  return state;
}

// The current native challenge falls below the ordinary commitment threshold,
// so the old policy would keep the press. The new exception releases it only
// for a fresh, reachable standing-tackle winner on the same carrier.
for (const defendingSide of ['home', 'away']) {
  const positive = makeHandle({ defendingSide });
  const savedContext = TF.getTacticalContext;
  const checkpoint = TF.engine.saveCheckpoint(positive.handle);
  const restored = TF.engine.restoreCheckpoint(checkpoint);
  const restoredState = { ...positive, handle: restored, match: restored.match,
    tackler: restored.match.playersById[positive.tackler.id], carrier: restored.match.playersById[positive.carrier.id] };
  const [originalStep, restoredStep] = withPressReservation(positive, () => [TF.engine.stepMatch(positive.handle, 1), TF.engine.stepMatch(restored, 1)]);
  assert.equal(positive.match.tick, 101);
  assert.equal(restored.match.tick, 101);
  const selected = decision(positive);
  assert.ok(selected, 'natural fixed-tick step should run the due defender decision');
  const standing = selected.candidates.find(candidate => candidate.type === 'challenge' && candidate.details.physicsAction === 'standingtackle');
  assert.ok(standing, `${defendingSide} fresh reachable fixture should produce a native standing-tackle candidate`);
  assert.ok(standing.utility > 0.72 && standing.utility < selected.commitment.threshold,
    `${defendingSide} challenge should be stronger than the old press but below normal commitment threshold`);
  assert.equal(selected.commitment.previousType, 'press');
  assert.equal(selected.commitment.held, false, `${defendingSide} higher-utility eligible tackle must bypass the held press`);
  assert.equal(selected.selected.type, 'challenge');
  assert.equal(positive.tackler.intent.type, 'challenge');
  assert.ok(positive.match.events.some(event => event.type === 'tackle' && event.defenderId === positive.tackler.id && event.attackerId === positive.carrier.id),
    `${defendingSide} AI-selected tackle must reach ordinary physical resolution`);
  assert.equal(TF.hashCheckpoint(TF.captureCheckpoint(positive.match)), TF.hashCheckpoint(TF.captureCheckpoint(restored.match)),
    `${defendingSide} next-decision continuation must match after facade checkpoint restore`);
  assert.deepEqual(positive.match.events, restored.match.events, `${defendingSide} restored decision must emit the same physical events`);
  TF.getTacticalContext = savedContext;
}

// A candidate that loses to the old press stays committed; no challenge, stale
// memory, blocked foot path, or active physical recovery also keeps the press.
const weaker = decisionTwin({ oldUtility: 0.98 });
const weakerChallenge = decision(weaker).candidates.find(c => c.type === 'challenge' && c.details.physicsAction === 'standingtackle');
assert.ok(weakerChallenge && weakerChallenge.utility <= 0.98, 'negative control must retain a native challenge weaker than the old press');
assert.equal(weaker.tackler.intent.type, 'press');
assert.equal(decision(weaker).commitment.held, true, 'a weaker current challenge must not release the press');

for (const [label, options] of [
  ['stale owner', { ownerAge: 30 }],
  ['low-confidence owner', { ownerConfidence: 0.4 }],
  ['low-confidence ball', { ballConfidence: 0.35 }],
  ['missing owner observation', { omitOwnerObservation: true }],
  ['blocked foot path', { geometry: 'blocked' }],
  ['challenge recovery', { recovery: 102 }],
]) {
  const state = decisionTwin(options);
  assert.equal(decision(state).candidates.some(c => c.type === 'challenge' && c.details.physicsAction === 'standingtackle'), false,
    `${label} must not create a native eligible standing challenge`);
  assert.equal(state.tackler.intent.type, 'press', `${label} must preserve ordinary press commitment`);
  assert.equal(state.tackler.intent.targetId, state.carrier.id, `${label} must preserve the same press target`);
}

const nonPress = decisionTwin({ oldType: 'slide', oldUtility: 0.72 });
assert.ok(decision(nonPress).candidates.some(c => c.type === 'challenge' && c.details.physicsAction === 'standingtackle'));
assert.equal(nonPress.tackler.intent.type, 'slide', 'the exception must not release a non-press commitment');
assert.equal(decision(nonPress).commitment.held, true);

const visibleTwin = decisionTwin({});
const hiddenTwin = decisionTwin({ hiddenCarrierShift: true });
assert.deepEqual(hiddenTwin.tackler.beliefState, visibleTwin.tackler.beliefState, 'hidden-world twin must preserve actor-local beliefs');
assert.equal(hiddenTwin.tackler.ai.decisionExplanation.selected.type, visibleTwin.tackler.ai.decisionExplanation.selected.type,
  'hidden carrier/ball coordinates must not change the actor decision');
assert.equal(hiddenTwin.tackler.ai.decisionExplanation.selected.targetId, visibleTwin.tackler.ai.decisionExplanation.selected.targetId,
  'hidden carrier/ball coordinates must not change the selected target');

TF.getTacticalContext = originalContext;
process.stdout.write('fresh reachable higher-utility standing tackle releases a held press in both directions; weaker, stale, blocked, recovering, non-press, hidden-world, and checkpoint controls pass\n');
