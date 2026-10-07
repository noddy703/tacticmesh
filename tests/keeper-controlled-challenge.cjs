'use strict';
const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
const TF = globalThis.TF;

function fixture(side = 'home') {
  const match = TF.createMatch({ seed: 44101, matchId: `keeper-controlled-${side}`, halfSeconds: 90 });
  match.state.phase = 'open-play'; match.tick = 120; match.clock.elapsedSeconds = 2;
  const keeperTeam = match.teams.find(t => t.side === side), otherTeam = match.teams.find(t => t.id !== keeperTeam.id);
  const keeper = keeperTeam.activePlayers.find(p => p.isGoalkeeper);
  const carrier = otherTeam.activePlayers.find(p => !p.isGoalkeeper && p.positionFamily === 'FWD');
  const dir = keeperTeam.attackDirection, ownX = dir > 0 ? 0 : match.pitch.length;
  keeper.position = { x: ownX + dir * 10.5, y: 34, z: 0 }; keeper.previousPosition = { ...keeper.position };
  keeper.velocity.x = keeper.velocity.y = 0; keeper.facing = { x: dir, y: 0 };
  keeper.attributes.reach = 90; keeper.attributes.handling = 80; keeper.attributes.catching = 80; keeper.attributes.reflexes = 80;
  carrier.position = { x: ownX + dir * 12, y: 34, z: 0 }; carrier.previousPosition = { ...carrier.position };
  carrier.velocity.x = carrier.velocity.y = 0; carrier.facing = { x: dir, y: 0 };
  match.ball.ownerId = carrier.id; match.ball.handControl = false; match.ball.controlState = 'controlled';
  match.ball.position = { x: ownX + dir * 11.45, y: 34, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position }; match.ball.velocity = { x: 0, y: 0, z: 0 };
  match.ball.lastTouchTeamId = carrier.teamId; match.ball.lastTouchPlayerId = carrier.id; match.ball.lastTouchKind = 'carry';
  for (const p of match.players) {
    p.previousPosition = { ...p.position }; p.velocity.x = p.velocity.y = 0;
    p.motor = p.intent = p.currentAction = { type: 'hold', action: 'hold', target: { x: p.position.x, y: p.position.y }, desiredSpeed: 0, expiresTick: match.tick + 60 };
  }
  keeper.facing = { x: dir, y: 0 };
  keeper.beliefState = {
    entities: { [carrier.id]: { id: carrier.id, teamId: carrier.teamId, role: carrier.role, positionFamily: carrier.positionFamily,
      position: { x: carrier.position.x, y: carrier.position.y }, estimatedPosition: { x: carrier.position.x, y: carrier.position.y },
      velocity: { x: 0, y: 0 }, facing: { x: dir, y: 0 }, confidence: .95, baseConfidence: .95, observedTick: match.tick, ageTicks: 0 } },
    ball: { position: { ...match.ball.position }, estimatedPosition: { x: match.ball.position.x, y: match.ball.position.y },
      velocity: { x: 0, y: 0, z: 0 }, estimatedZ: .11, estimatedVelocityZ: 0, ownerId: carrier.id, lastTouchTeamId: carrier.teamId,
      confidence: .95, baseConfidence: .95, observedTick: match.tick, ageTicks: 0 },
    lastScanTick: match.tick, updatedTick: match.tick, observations: []
  };
  keeper.ai = { nextDecision: match.tick, lastDecision: match.tick - 20 };
  keeper.motor = keeper.intent = keeper.currentAction = { type: 'hold', action: 'hold', target: { x: keeper.position.x, y: keeper.position.y }, desiredSpeed: 0, expiresTick: match.tick + 60 };
  return { match, keeper, carrier, dir, ownX };
}
function challengeIntent(f) {
  const ball = f.match.ball, keeper = f.keeper;
  keeper.motor = keeper.intent = keeper.currentAction = { type: 'challenge', action: 'keeperchallenge', target: { x: ball.position.x, y: ball.position.y }, desiredSpeed: 0, expiresTick: f.match.tick + 12 };
  keeper.rng = { next: () => 0 };
}
function physics(f) { TF.updatePhysics(f.match, TF.FIXED_DT); }

// The actor's local fresh observation creates the keeper-only challenge option.
for (const side of ['home', 'away']) {
  const f = fixture(side);
  TF.updateAI(f.match, TF.FIXED_DT);
  const candidate = (f.keeper.ai.candidates || []).find(c => c.type === 'challenge' && c.details && c.details.handChallenge);
  assert.ok(candidate, `${side} keeper did not consider a fresh, reachable, unshielded opponent ball`);
  assert.equal(candidate.details.physicsAction, 'keeperchallenge');
  assert.equal(candidate.details.targetId, f.carrier.id);
  assert.equal(f.keeper.intent.type, 'challenge', `${side} keeper's selected AI action should reach its motor`);
  assert.equal(f.keeper.motor.action, 'keeperchallenge');

  // The selected motor action reaches physical resolution; only the contact
  // RNG is fixed here so this regression checks the successful branch.
  f.keeper.rng = { next: () => 0 };
  physics(f);
  assert.equal(f.match.ball.ownerId, f.keeper.id, `${side} close unshielded keeper contact did not collect the ball`);
  assert.equal(f.match.ball.handControl, true);
  const collection = f.match.events.find(e => e.type === 'keeper-collection');
  assert.ok(collection && collection.caught && collection.challengedPlayerId === f.carrier.id);
  assert.equal(collection.shotBy, null, 'non-shot keeper collection must not be counted as a save');
}

// A fast sprint does not erase a locally coherent owner claim: the observed
// ball and carrier move together. A released trajectory with a stale nearby
// owner remains a flight and must not produce a hand challenge.
{
  const f = fixture('home');
  f.carrier.velocity.x = f.dir * 8; f.match.ball.velocity.x = f.dir * 8;
  TF.updateAI(f.match, TF.FIXED_DT);
  assert.ok((f.keeper.ai.candidates || []).some(c => c.type === 'challenge' && c.details && c.details.handChallenge),
    'coherent 8 m/s dribble should remain a challengeable owner belief');
}
{
  const f = fixture('home');
  f.carrier.velocity.x = 0; f.match.ball.velocity.x = f.dir * 12;
  TF.updateAI(f.match, TF.FIXED_DT);
  assert.ok(!(f.keeper.ai.candidates || []).some(c => c.type === 'challenge' && c.details && c.details.handChallenge),
    'fast ball separating from its remembered carrier should be treated as released flight, not a hand-challenge target');
}

function rejected(mutator, label) {
  const f = fixture('home'); mutator(f); challengeIntent(f); physics(f);
  assert.equal(f.match.ball.ownerId, f.carrier.id, `${label}: illegal/unreachable challenge changed possession`);
  assert.equal(f.match.events.some(e => e.type === 'keeper-collection' || e.type === 'keeper-punch'), false, `${label}: illegal contact event`);
  return f;
}
rejected(f => { f.keeper.position.x += f.dir * 4; f.keeper.motor.target.x = f.keeper.position.x; }, 'out of reach');
rejected(f => { f.keeper.position.x = f.ownX + f.dir * 15.7; f.match.ball.position.x = f.ownX + f.dir * 16.6; f.carrier.position.x = f.ownX + f.dir * 17.2; f.keeper.motor.target = { x: f.keeper.position.x, y: f.keeper.position.y }; }, 'outside own penalty area while still in contact reach');
rejected(f => { f.keeper.facing = { x: -f.dir, y: 0 }; }, 'keeper facing away from ball');
{
  const f = fixture('home'); f.match.ball.position.z = 2.5; f.match.ball.velocity.z = 0; f.carrier._lastControlTouchTick = f.match.tick;
  challengeIntent(f); physics(f);
  assert.notEqual(f.match.ball.ownerId, f.keeper.id, 'keeperchallenge must not collect above its contact range');
  assert.equal(f.match.events.some(e => e.type === 'keeper-collection' || e.type === 'keeper-punch'), false, 'high ball must not emit keeper hand contact');
}
rejected(f => { f.carrier.teamId = f.keeper.teamId; f.match.ball.lastTouchTeamId = f.keeper.teamId; }, 'same-team carrier');
rejected(f => { f.match.ball.handControl = true; }, 'already hand-controlled ball');
rejected(f => { f.match.ball.position.x = f.ownX + f.dir * 11.1; f.carrier.position.x = f.ownX + f.dir * 12; f.carrier.facing = { x: -f.dir, y: 0 }; f.keeper.position.x = f.ownX + f.dir * 11.7; f.keeper.position.y = 34.72; f.keeper.motor.target = { x: f.keeper.position.x, y: f.keeper.position.y }; f.keeper.facing = { x: -f.dir * .33, y: -.944 }; }, 'carrier shields ball');
rejected(f => { f.match.ball.lastTouchTeamId = f.keeper.teamId; f.match.ball.lastTouchKind = 'deliberate'; f.match.ball._sameTeamBackpass = true; }, 'same-team deliberate backpass');

// A failed contact remains a physical deflection and the recovery window stops
// a renewed stale intent from producing another contact on the next tick.
{
  const f = fixture('home'); challengeIntent(f); f.keeper.rng.next = () => .999; physics(f);
  assert.equal(f.match.ball.ownerId, null, 'failed contact should leave a live loose ball');
  assert.ok(Math.hypot(f.match.ball.velocity.x, f.match.ball.velocity.y) > 0.8, 'failed contact should impart a real impulse');
  assert.ok(f.match.events.some(e => e.type === 'keeper-punch' && e.caught === false));
  f.match.tick++; f.match.clock.elapsedSeconds += TF.FIXED_DT;
  f.match.ball.ownerId = f.carrier.id; f.match.ball.handControl = false; f.match.ball.controlState = 'controlled';
  f.match.ball.position = { x: f.ownX + f.dir * 11.45, y: 34, z: 0.11 };
  f.match.ball.previousPosition = { ...f.match.ball.position }; f.match.ball.velocity = { x: 0, y: 0, z: 0 };
  f.match.ball.lastTouchTeamId = f.carrier.teamId; f.match.ball.lastTouchPlayerId = f.carrier.id; f.match.ball.lastTouchKind = 'carry';
  challengeIntent(f); physics(f);
  assert.equal(f.match.ball.ownerId, f.carrier.id, 'recovery window must prevent a renewed challenge while an opponent still controls the ball');
  assert.equal(f.match.events.filter(e => e.type === 'keeper-punch' || e.type === 'keeper-collection').length, 1);
}

// Fresh local belief is required to propose the action: stale memory cannot
// justify a challenge when the actor is not receiving a new observation.
{
  const f = fixture('home'), cycle = TF.getPerceptionScanInterval(f.keeper, f.match);
  function hash(s) { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const phase = hash(f.keeper.id) % cycle;
  f.match.tick = Array.from({ length: cycle }, (_, i) => i + 1).find(t => (t + phase) % cycle !== 0);
  f.keeper.ai.nextDecision = f.match.tick; f.keeper.ai.lastDecision = f.match.tick - 20;
  f.keeper.beliefState.lastScanTick = f.match.tick - 60;
  f.keeper.beliefState.ball.observedTick = f.match.tick - 60; f.keeper.beliefState.ball.ageTicks = 60;
  const owner = f.keeper.beliefState.entities[f.carrier.id]; owner.observedTick = f.match.tick - 60; owner.ageTicks = 60;
  TF.updateAI(f.match, TF.FIXED_DT);
  assert.ok(!(f.keeper.ai.candidates || []).some(c => c.type === 'challenge' && c.details && c.details.handChallenge), 'stale observation must not propose a keeper challenge');
}

process.stdout.write('keeper controlled-ball challenge is belief-led, mirrored, physically bounded, lawful, and recovery-limited\n');
