'use strict';

const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
const TF = globalThis.TF;

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < String(text).length; i += 1) {
    value ^= String(text).charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function scenario({ seed, carrierSide, observerMode, flight = 'coherent', hiddenWorld = false }) {
  const match = TF.createMatch({ seed, matchId: `fast-owner-${seed}`, homeFormation: '4-3-3', awayFormation: '4-3-3' });
  const carrierTeam = match.teams.find((team) => team.side === carrierSide);
  const observerTeam = observerMode === 'support' ? carrierTeam : match.teams.find((team) => team !== carrierTeam);
  const carrier = carrierTeam.activePlayers.find((player) => player.positionFamily === 'FWD' && !player.isGoalkeeper);
  const actor = observerTeam.activePlayers.find((player) => player !== carrier && !player.isGoalkeeper
    && (observerMode === 'support' ? player.positionFamily === 'MID' : player.positionFamily === 'DEF'));
  const mate = observerTeam.activePlayers.find((player) => player !== actor && player !== carrier && !player.isGoalkeeper);
  const dir = carrierTeam.attackDirection;
  const carrierX = dir > 0 ? 24 : 81;
  carrier.position = { x: carrierX, y: 34, z: 0 };
  carrier.velocity = { x: dir * 8, y: 0, z: 0 };
  carrier.facing = { x: dir, y: 0 };
  actor.position = observerMode === 'support'
    ? { x: carrierX - dir * 6, y: 27, z: 0 }
    : { x: carrierX, y: 35.2, z: 0 };
  actor.velocity = { x: 0, y: 0, z: 0 };
  actor.facing = observerMode === 'support' ? { x: dir, y: 0 } : { x: 0, y: -1 };
  mate.position = { x: carrierX - dir * 9, y: 42, z: 0 };
  const ballX = carrierX + (flight === 'distant' ? dir * 2 : 0);
  const ballY = observerMode === 'support' ? 34 : 34.4;
  const ballZ = flight === 'aerial' ? 0.9 : 0.11;
  const ballVx = flight === 'separating' ? dir * 12 : dir * 8;
  match.ball.position = { x: ballX, y: ballY, z: ballZ };
  match.ball.velocity = { x: ballVx, y: 0, z: flight === 'aerial' ? 2 : 0 };
  match.ball.ownerId = carrier.id;
  carrier.hasBall = true;

  const cycle = TF.getPerceptionScanInterval(actor, match);
  let tick = 1;
  while ((tick + hash(actor.id) % cycle) % cycle === 0) tick += 1;
  match.tick = tick;
  const ownerAge = flight === 'stale' ? 20 : 1;
  const ownerConfidence = flight === 'low-confidence' ? 0.2 : 0.95;
  const ballConfidence = flight === 'low-ball-confidence' ? 0.15 : 0.95;
  const ownerBaseX = carrier.position.x - carrier.velocity.x * ownerAge / 60;
  function entity(player, confidence, ageTicks, velocity) {
    return {
      id: player.id, teamId: player.teamId,
      position: { x: player === carrier ? ownerBaseX : player.position.x, y: player.position.y },
      estimatedPosition: { x: player.position.x, y: player.position.y }, velocity: velocity || { x: 0, y: 0 },
      facing: { x: player.facing.x, y: player.facing.y }, confidence, baseConfidence: confidence,
      observedTick: tick - ageTicks, ageTicks, source: 'vision',
    };
  }
  actor.beliefState = {
    entities: {
      [carrier.id]: entity(carrier, ownerConfidence, ownerAge, { x: carrier.velocity.x, y: 0 }),
      [mate.id]: entity(mate, 0.95, 1),
    },
    updatedTick: tick - 1, lastScanTick: tick - 1, observations: [],
    ball: {
      position: { x: ballX, y: ballY, z: ballZ }, estimatedPosition: { x: ballX, y: ballY },
      velocity: { x: ballVx, y: 0, z: flight === 'aerial' ? 2 : 0 },
      estimatedZ: ballZ, estimatedVelocityZ: flight === 'aerial' ? 2 : 0,
      confidence: ballConfidence, baseConfidence: ballConfidence, observedTick: tick - 1, ageTicks: 1,
      ownerId: carrier.id, lastTouchTeamId: carrier.teamId,
    },
  };
  if (hiddenWorld) {
    // Keep the observer's beliefs fixed while changing only unseen physical truth.
    match.ball.ownerId = null;
    carrier.position.x += dir * 25;
    carrier.position.y = 6;
    carrier.velocity.x = 0;
  }
  for (const player of match.players) {
    player.ai = player.ai || {};
    player.ai.nextDecision = 999999;
  }
  actor.ai.nextDecision = tick;
  TF.updateAI(match, 1 / 60);
  const explanation = actor.ai.decisionExplanation;
  return {
    match, actor, carrier, tick, explanation,
    candidates: explanation.candidates,
    selected: explanation.selected,
    observedBallOwner: actor.beliefState.ball.ownerId,
    signature: JSON.stringify({ selected: explanation.selected, candidates: explanation.candidates }),
  };
}

for (const carrierSide of ['home', 'away']) {
  const defender = scenario({ seed: carrierSide === 'home' ? 4101 : 4102, carrierSide, observerMode: 'defend' });
  assert.ok(defender.candidates.some((candidate) => candidate.type === 'press' && candidate.details.targetId === defender.carrier.id),
    `${carrierSide} coherent fast carrier should remain an observed press target`);
  assert.ok(defender.candidates.some((candidate) => candidate.type === 'challenge' && candidate.details.targetId === defender.carrier.id
    && candidate.details.physicsAction === 'standingtackle'),
  `${carrierSide} coherent fast carrier should offer the physically bounded standing challenge`);

  const support = scenario({ seed: carrierSide === 'home' ? 4111 : 4112, carrierSide, observerMode: 'support' });
  assert.ok(support.candidates.some((candidate) => candidate.type === 'support'),
    `${carrierSide} coherent fast teammate carrier should preserve possession support`);
  assert.ok(!support.candidates.some((candidate) => ['receive', 'intercept'].includes(candidate.type)),
    `${carrierSide} coherent fast teammate carry should not turn into a loose-ball receipt`);

  for (const flight of ['separating', 'aerial', 'stale', 'low-confidence', 'low-ball-confidence', 'distant']) {
    const seedBase = 4120 + ['separating', 'aerial', 'stale', 'low-confidence', 'low-ball-confidence', 'distant'].indexOf(flight) * 4 + (carrierSide === 'away' ? 30 : 0);
    const unsupported = scenario({ seed: seedBase, carrierSide, observerMode: 'support', flight });
    assert.ok(!unsupported.candidates.some((candidate) => candidate.type === 'support'),
      `${carrierSide} ${flight} trace must not preserve unsupported teammate possession`);
    const unsupportedChallenge = scenario({ seed: seedBase + 1, carrierSide, observerMode: 'defend', flight });
    assert.ok(!unsupportedChallenge.candidates.some((candidate) => candidate.type === 'challenge'),
      `${carrierSide} ${flight} trace must not create a carrier-based defensive challenge`);
  }

  const seen = scenario({ seed: carrierSide === 'home' ? 4191 : 4192, carrierSide, observerMode: 'support' });
  const hidden = scenario({ seed: carrierSide === 'home' ? 4191 : 4192, carrierSide, observerMode: 'support', hiddenWorld: true });
  assert.deepEqual(hidden.actor.beliefState, seen.actor.beliefState,
    `${carrierSide} unseen physical changes must not rewrite the local belief snapshot`);
  assert.equal(hidden.signature, seen.signature,
    `${carrierSide} unseen owner/position changes must not change the actor's decision`);
}

process.stdout.write('Fast coherent owner beliefs preserve mirrored support and challenge; unsupported flight remains loose and hidden truth is ignored.\n');
