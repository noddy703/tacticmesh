'use strict';
const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');

const TF = globalThis.TF;
const clone = value => JSON.parse(JSON.stringify(value));
function hash(text) { let value = 2166136261; for (const c of String(text)) { value ^= c.charCodeAt(0); value = Math.imul(value, 16777619); } return value >>> 0; }

function makeCase({ side = 'away', blocker = true, stale = false, hiddenPosition = null, observedBlockerPosition = null, omitBlockerObservation = false, priorRisk = 0 } = {}) {
  const match = TF.createMatch({ seed: 2026123, homeFormation: '4-3-3', awayFormation: '4-2-3-1' });
  const dir = side === 'away' ? -1 : 1;
  const otherSide = side === 'away' ? 'home' : 'away';
  const taker = match.playersById[`${side}-p04`];
  const receiver = match.playersById[`${side}-p05`];
  const safeReceiver = match.playersById[`${side}-p02`];
  const blockerPlayer = match.playersById[`${otherSide}-p11`];
  const startX = dir < 0 ? 99.5 : 5.5;
  const oldTarget = { x: startX + dir * 22.5, y: 11, z: 0 };
  const safeTarget = { x: dir < 0 ? 81 : 24, y: 58, z: 0 };
  const blockerX = startX + dir * 11;
  match.tick = 3000;
  taker.position = { x: startX, y: 34 }; taker.velocity = { x: 0, y: 0 };
  taker.facing = { x: dir, y: 0 };
  Object.assign(taker.attributes, { vision: 95, decisionMaking: 95, awareness: 95, anticipation: 85, teamwork: 85, shortPassing: 85, throughBalls: 85 });
  for (const player of match.teams.find(team => team.id === side).activePlayers) {
    if ([taker.id, receiver.id, safeReceiver.id, `${side}-p03`].includes(player.id)) continue;
    player.position = { x: dir < 0 ? 35 : 70, y: 7 + ((Number(player.id.slice(-2)) || 1) % 9) * 7 };
  }
  match.playersById[`${side}-p02`].position = safeTarget;
  match.playersById[`${side}-p03`].position = { x: dir < 0 ? 85 : 20, y: 45 };
  receiver.position = { x: startX + dir * 19.5, y: 12 }; receiver.velocity = { x: dir, y: 0 };
  blockerPlayer.position = hiddenPosition || { x: blockerX, y: blocker ? 23.8 : 45 };
  blockerPlayer.velocity = { x: 0, y: 0 }; blockerPlayer.facing = { x: -dir * .7, y: -.7 };
  match.ball.position = { x: startX, y: 34, z: .11 };
  match.ball.velocity = { x: 0, y: 0, z: 0 };
  match.ball.ownerId = taker.id; taker.hasBall = true;
  match.state.restartInProgress = { type: 'goal-kick', teamId: side, takerId: taker.id, point: { x: startX, y: 34 } };
  match.state.restartSequence = 25;

  const entities = {};
  for (const player of match.teams.flatMap(team => team.activePlayers)) {
    if (player.id === taker.id) continue;
    let position = { x: player.position.x, y: player.position.y };
    let velocity = { x: player.velocity.x || 0, y: player.velocity.y || 0 };
    let confidence = .95;
    let observedTick = match.tick;
    if (player.id === blockerPlayer.id) {
      // The defender's belief is held fixed across hidden-world controls.
      position = observedBlockerPosition || { x: blockerX, y: 23.8 };
      velocity = { x: 0, y: 0 };
      confidence = stale ? .5 : .95;
      observedTick = match.tick - (stale ? 60 : 0);
    }
    if (player.id === blockerPlayer.id && omitBlockerObservation) continue;
    entities[player.id] = {
      id: player.id, teamId: player.teamId, role: player.role,
      position, estimatedPosition: { ...position }, velocity,
      facing: { x: player.facing.x || 1, y: player.facing.y || 0 },
      confidence, baseConfidence: confidence, observedTick,
      ageTicks: match.tick - observedTick, source: 'vision'
    };
  }
  taker.beliefState = {
    updatedTick: match.tick, lastScanTick: match.tick, observations: [], entities,
    ball: { position: { x: startX, y: 34, z: .11 }, estimatedPosition: { x: startX, y: 34 },
      velocity: { x: 0, y: 0, z: 0 }, estimatedZ: .11, estimatedVelocityZ: 0,
      confidence: .95, baseConfidence: .95, observedTick: match.tick, ageTicks: 0,
      ownerId: taker.id, lastTouchTeamId: side }
  };
  taker.intent = {
    type: 'throughBall', action: 'throughBall', target: oldTarget,
    ballTarget: oldTarget, targetId: receiver.id,
    createdTick: match.tick - 1, commitUntilTick: match.tick + 20, expiresTick: match.tick + 30,
    utility: .7335, power: .93, lift: .12, teamIdAtCreation: taker.teamId,
    details: { targetId: receiver.id, kickOrigin: { x: startX, y: 34 },
      laneInterceptionRisk: priorRisk, receiverConfidence: .95, receiverAgeTicks: 0,
      restartApproach: { sequence: 25 } }
  };
  taker.ai = { nextDecision: match.tick, lastDecision: match.tick - 1 };
  const scanCycle = TF.getPerceptionScanInterval(taker, match);
  while ((match.tick + hash(taker.id)) % scanCycle === 0) match.tick += 1;
  taker.ai.nextDecision = match.tick;
  return { match, taker, receiver, safeReceiver, blockerPlayer, safeTarget, oldTarget };
}

function evaluate(options = {}) {
  const state = makeCase(options);
  const { includeSafeCandidate = true } = options;
  let context = null;
  const originalAugment = TF.augmentCandidates;
  TF.augmentCandidates = function (candidates, value) {
    if (value.self.id === state.taker.id) {
      context = value;
      // Isolate restart-lock selection from outlet discovery while keeping the
      // chosen lock's risk calculation tied to the actor's local DTOs.
      if (includeSafeCandidate) candidates.push({ type: 'pass', target: state.safeTarget, utility: .88,
        details: { targetId: state.safeReceiver.id, laneInterceptionRisk: 0, receiverConfidence: .95, receiverAgeTicks: 0 } });
    }
    return originalAugment ? originalAugment(candidates, value) : candidates;
  };
  try { TF.updateAI(state.match, 1 / 60); } finally { TF.augmentCandidates = originalAugment; }
  return { ...state, context, decision: state.taker.ai.decisionExplanation, intent: clone(state.taker.intent) };
}

function evaluateRepeatedNoSafer(side) {
  const state = makeCase({ side, blocker: true, priorRisk: .72 });
  const seen = [];
  const candidatePasses = [];
  const originalAugment = TF.augmentCandidates;
  TF.augmentCandidates = function (candidates, value) {
    const result = originalAugment ? originalAugment(candidates, value) : candidates;
    if (value.self.id === state.taker.id) {
      // This is the already selected ray, now known to be materially risky;
      // the fixture offers no safer current pass lane to switch to.
      result.push({ type: 'throughBall', target: state.oldTarget, utility: .88,
        details: { targetId: state.receiver.id, laneInterceptionRisk: .72, receiverConfidence: .95, receiverAgeTicks: 0 } });
      candidatePasses.push(result.filter(c => ['pass', 'throughBall', 'cross', 'cutback', 'switch'].includes(c.type)).map(c => ({ type: c.type, targetId: c.details.targetId, risk: c.details.laneInterceptionRisk })));
    }
    return result;
  };
  try {
    for (let i = 0; i < 3; i += 1) {
      if (i > 0) {
        state.match.tick += 6;
        state.taker.ai.nextDecision = state.match.tick;
      }
      TF.updateAI(state.match, 1 / 60);
      seen.push(clone(state.taker.intent));
    }
  } finally { TF.augmentCandidates = originalAugment; }
  return { intents: seen, decision: state.taker.ai.decisionExplanation, candidatePasses };
}

function assertThreatAndSafeControls(side) {
  const threatened = evaluate({ side, blocker: true });
  const localBlocker = threatened.context.opponents.find(e => e.id === threatened.blockerPlayer.id);
  assert.ok(localBlocker && localBlocker.ageTicks <= 3 && localBlocker.confidence >= .9, `${side} positive requires a fresh observed defender`);
  assert.ok(threatened.decision.candidates.some(c => c.type === 'pass' && c.details.targetId === threatened.safeReceiver.id), `${side} fixture should retain a safe current pass option`);
  assert.ok(!(threatened.intent.type === 'throughBall' && threatened.intent.targetId === threatened.receiver.id), `${side} restart lock retained a through-ball into fresh local lane danger`);

  const clear = evaluate({ side, blocker: false, observedBlockerPosition: { x: side === 'away' ? 88.5 : 16.5, y: 45 } });
  assert.equal(clear.intent.type, 'throughBall', `${side} safe locked restart option should remain stable`);
  assert.equal(clear.intent.targetId, clear.receiver.id, `${side} safe lock should retain its receiver`);
  assert.deepEqual(clear.intent.ballTarget, { x: side === 'away' ? 77 : 28, y: 11, z: 0 }, `${side} safe lock should preserve its exact legal restart ray`);

  const unseen = evaluate({ side, blocker: true, omitBlockerObservation: true });
  assert.equal(unseen.intent.type, 'throughBall', `${side} unseen opponent must not invalidate a restart lock`);
  assert.equal(unseen.intent.targetId, unseen.receiver.id, `${side} unseen opponent must not change the locked receiver`);
  assert.deepEqual(unseen.intent.ballTarget, { x: side === 'away' ? 77 : 28, y: 11, z: 0 }, `${side} unseen opponent must not change the locked target`);

  const stale = evaluate({ side, blocker: true, stale: true });
  assert.equal(stale.intent.type, 'throughBall', `${side} stale memory should not invalidate a restart lock`);

  const hiddenChanged = evaluate({ side, blocker: true, hiddenPosition: { x: side === 'away' ? 40 : 65, y: 60 } });
  assert.equal(hiddenChanged.intent.type, threatened.intent.type, `${side} unobserved defender movement changed the decision`);
  assert.equal(hiddenChanged.intent.targetId, threatened.intent.targetId, `${side} unobserved defender movement changed the target`);
  assert.deepEqual(hiddenChanged.intent.target, threatened.intent.target, `${side} unobserved defender movement changed the target point`);

  const noSafer = evaluate({ side, blocker: true, priorRisk: .72, includeSafeCandidate: false });
  assert.equal(noSafer.intent.type, 'throughBall', `${side} uniformly risky restart choices should not dislodge the established legal action`);
  assert.equal(noSafer.intent.targetId, noSafer.receiver.id, `${side} uniformly risky choices should not churn the target`);
  assert.deepEqual(noSafer.intent.ballTarget, { x: side === 'away' ? 77 : 28, y: 11, z: 0 }, `${side} uniformly risky choices should preserve the selected ray`);

  const repeated = evaluateRepeatedNoSafer(side);
  assert.equal(repeated.intents.length, 3);
  assert.ok(repeated.candidatePasses.length === 3 && repeated.candidatePasses.every(options => options.length === 1 && options.every(c => Number(c.risk) >= .58)), `${side} repeated no-safer control should expose only materially risky current pass lanes: ${JSON.stringify(repeated.candidatePasses)}`);
  for (const intent of repeated.intents) {
    assert.equal(intent.type, 'throughBall', `${side} similarly risky repeated decisions should keep the legal action`);
    assert.equal(intent.targetId, `${side}-p05`, `${side} similarly risky repeated decisions should not retarget`);
    assert.deepEqual(intent.ballTarget, { x: side === 'away' ? 77 : 28, y: 11, z: 0 }, `${side} similarly risky repeated decisions should preserve the ray`);
  }
}

assertThreatAndSafeControls('away');
assertThreatAndSafeControls('home');
process.stdout.write('restart pass lock revalidates fresh local lane danger in both directions and preserves safe, stale, and hidden-world controls\n');
