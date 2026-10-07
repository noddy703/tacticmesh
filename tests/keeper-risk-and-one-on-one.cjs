'use strict';
const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
const TF = globalThis.TF;

function identityBelief(player, tick, overrides = {}) {
  const point = overrides.position || player.position;
  const velocity = overrides.velocity || player.velocity || { x: 0, y: 0 };
  return {
    id: player.id, teamId: overrides.teamId || player.teamId,
    role: player.role, positionFamily: player.positionFamily, isGoalkeeper: !!player.isGoalkeeper,
    position: { x: point.x, y: point.y }, estimatedPosition: { x: point.x, y: point.y },
    velocity: { x: velocity.x || 0, y: velocity.y || 0 },
    facing: { ...(overrides.facing || player.facing || { x: 1, y: 0 }) },
    confidence: overrides.confidence == null ? 0.96 : overrides.confidence,
    baseConfidence: overrides.confidence == null ? 0.96 : overrides.confidence,
    observedTick: tick - (overrides.ageTicks || 0), ageTicks: overrides.ageTicks || 0,
    source: 'vision'
  };
}

function noScanTick(player, match, start = 180) {
  const cycle = TF.getPerceptionScanInterval(player, match);
  let tick = start;
  while ((tick + hash(player.id)) % cycle === 0) tick++;
  return tick;
}
function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

function footFixture({ side = 'home', keeperDepth = 12, pressDistance = 3.1, safeOutlet = false, compromisedOutlet = false } = {}) {
  const match = TF.createMatch({ seed: 61120, halfSeconds: 90, matchId: `keeper-foot-risk-${side}-${keeperDepth}-${pressDistance}-${safeOutlet}-${compromisedOutlet}` });
  const team = match.teams.find(t => t.side === side), opponents = match.teams.find(t => t !== team);
  const keeper = team.activePlayers.find(p => p.isGoalkeeper);
  const ownX = team.attackDirection > 0 ? 0 : match.pitch.length;
  const dir = team.attackDirection;
  const teammate = team.activePlayers.find(p => !p.isGoalkeeper && p.positionFamily === 'MID');
  const presser = opponents.activePlayers.find(p => !p.isGoalkeeper && p.positionFamily === 'FWD');
  const tick = noScanTick(keeper, match);
  match.tick = tick; match.clock.elapsedSeconds = tick * TF.FIXED_DT; match.state.phase = 'open-play'; match.state.restartType = null;
  for (const p of match.players) {
    p.velocity.x = p.velocity.y = 0;
    p.position = { x: 50, y: p.teamId === team.id ? 8 : 60, z: 0 };
    p.previousPosition = { ...p.position };
    p.intent = p.motor = p.currentAction = { type: 'hold', action: 'hold', target: { x: p.position.x, y: p.position.y }, desiredSpeed: 0, expiresTick: tick + 100 };
  }
  keeper.position = keeper.previousPosition = { x: ownX + dir * keeperDepth, y: 34, z: 0 };
  keeper.velocity.x = keeper.velocity.y = 0;
  keeper.facing = { x: dir, y: 0 };
  keeper.attributes.dribbling = 92; keeper.attributes.ballCarrying = 92;
  keeper.ai = { nextDecision: tick, lastDecision: tick - 10, tacticalPhase: 'organizedBuildUp' };
  for (const p of match.players.filter(p => p.teamId === team.id && p !== keeper)) {
    p.position = p.previousPosition = safeOutlet || compromisedOutlet
      ? { x: ownX + dir * 6.3, y: 31, z: 0 } : { x: ownX + dir * 43, y: 8, z: 0 };
    p.velocity.x = p.velocity.y = 0; p.facing = { x: dir, y: 0 };
  }
  presser.position = presser.previousPosition = { x: keeper.position.x + dir * pressDistance, y: 34, z: 0 };
  presser.velocity.x = -dir * 1.5; presser.velocity.y = 0; presser.facing = { x: -dir, y: 0 };
  if (compromisedOutlet) {
    const outletMarker = opponents.activePlayers.find(p => p !== presser && !p.isGoalkeeper);
    outletMarker.position = outletMarker.previousPosition = { x: teammate.position.x, y: teammate.position.y, z: 0 };
    outletMarker.velocity.x = -dir * 0.5;
  }
  const entities = {};
  for (const p of match.players) {
    if (p.id === keeper.id) continue;
    entities[p.id] = identityBelief(p, tick);
  }
  keeper.beliefState = {
    entities, updatedTick: tick, lastScanTick: tick, observations: [],
    ball: { position: { x: keeper.position.x + dir * 0.43, y: 34, z: 0.11 },
      estimatedPosition: { x: keeper.position.x + dir * 0.43, y: 34 },
      velocity: { x: 0, y: 0, z: 0 }, estimatedZ: 0.11, estimatedVelocityZ: 0,
      confidence: 0.97, baseConfidence: 0.97, observedTick: tick, ageTicks: 0,
      ownerId: keeper.id, lastTouchPlayerId: keeper.id, lastTouchTeamId: team.id }
  };
  match.ball.ownerId = keeper.id; match.ball.handControl = false; match.ball.controlState = 'controlled';
  match.ball.position = { x: keeper.position.x + dir * 0.43, y: 34, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position }; match.ball.velocity = { x: 0, y: 0, z: 0 };
  match.ball.lastTouchTeamId = team.id; match.ball.lastTouchPlayerId = keeper.id; match.ball.lastTouchKind = 'carry';
  return { match, keeper, teammate, presser, team, dir, ownX, keeperDepth };
}

function decideFoot(fixture) {
  TF.updateAI(fixture.match, TF.FIXED_DT);
  return fixture.keeper.ai.decisionExplanation;
}
function candidate(explanation, type, predicate = () => true) {
  return explanation.candidates.find(c => c.type === type && predicate(c)) || null;
}

// Pressed foot possession: risk is charged to forward carries independently
// of whether a viable outlet exists, and deeper-than-box positions remain
// exposed. A safe outlet remains selectable; it is never forced.
for (const side of ['home', 'away']) {
  const pressed = footFixture({ side, keeperDepth: 12, pressDistance: 3.1, safeOutlet: true });
  const explanation = decideFoot(pressed), forwards = explanation.candidates.filter(c => c.type === 'carry' && c.details.progressionGain > 0);
  const outlet = explanation.candidates.find(c => c.type === 'pass' && Number(c.utility) >= 0.38
    && Number(c.details.laneInterceptionRisk) <= 0.45 && Number(c.details.receiverOrientation) >= 0.16
    && Number(c.details.receiverConfidence) >= 0.62 && Number(c.details.receiverAgeTicks) <= 18
    && Number(c.details.nextSupportOptions) >= 1);
  assert.ok(outlet, `${side}: viable local outlet was not evaluated`);
  assert.ok(outlet.details.receiverConfidence >= 0.62 && outlet.details.receiverAgeTicks <= 18
    && outlet.details.laneInterceptionRisk <= 0.45 && outlet.details.receiverOrientation >= 0.16
    && outlet.details.nextSupportOptions >= 1 && outlet.utility >= 0.38,
  `${side}: fixture outlet does not meet keeper-safe-outlet contract`);
  assert.ok(forwards.length && forwards.every(c => c.details.keeperPressRiskPenalty > 0),
    `${side}: pressed forward carry escaped its exposure cost because a safe outlet exists`);
  assert.ok(outlet,
    `${side}: pressure penalty removed the safe distribution choice`);

  const compromised = footFixture({ side, keeperDepth: 12, pressDistance: 3.1, compromisedOutlet: true });
  const compromisedDecision = decideFoot(compromised);
  const safePass = compromisedDecision.candidates.find(c => c.type === 'pass'
    && c.utility >= 0.38 && c.details.laneInterceptionRisk <= 0.45 && c.details.receiverOrientation >= 0.16
    && c.details.receiverConfidence >= 0.62 && c.details.receiverAgeTicks <= 18 && c.details.nextSupportOptions >= 1);
  assert.equal(safePass, undefined, `${side}: deliberately covered outlet was still classified safe`);
  const retain = candidate(compromisedDecision, 'carry', c => c.details.route === 'keeper-goal-depth-retain');
  assert.ok(retain, `${side}: pressured keeper without a safe outlet lacked a goal-depth retention option`);
  assert.ok((retain.target.x - compromised.keeper.position.x) * compromised.dir < 0,
    `${side}: retention target did not move toward own-goal depth`);
}

const deepPressed = footFixture({ side: 'home', keeperDepth: 18.8, pressDistance: 3.1, safeOutlet: true });
const deepExplanation = decideFoot(deepPressed);
const deepForward = deepExplanation.candidates.filter(c => c.type === 'carry' && c.details.progressionGain > 0);
assert.ok(deepForward.length && deepForward.every(c => c.details.keeperPressRiskPenalty > 0.14),
  'near the 19m edge, a pressed forward carry lost its own-goal exposure cost');
const nearLine = footFixture({ side: 'home', keeperDepth: 7, pressDistance: 3.1, safeOutlet: true });
const nearLineExplanation = decideFoot(nearLine);
const nearLineForward = nearLineExplanation.candidates.filter(c => c.type === 'carry' && c.details.progressionGain > 0);
assert.ok(nearLineForward.length && nearLineForward.every(c => c.details.keeperPressRiskPenalty < 0.03),
  'a near-line keeper carry received the deep own-goal exposure penalty');

const unpressured = footFixture({ side: 'home', keeperDepth: 12, pressDistance: 18 });
const unpressuredExplanation = decideFoot(unpressured);
const unpressuredCarries = unpressuredExplanation.candidates.filter(c => c.type === 'carry' && c.details.progressionGain > 0);
assert.ok(unpressuredCarries.length && unpressuredCarries.every(c => c.details.keeperPressRiskPenalty === 0),
  'safe unpressured goalkeeper carry was penalized');
assert.equal(unpressuredExplanation.candidates.some(c => c.details.route === 'keeper-goal-depth-retain'), false,
  'unpressured keeper received an unnecessary defensive retention route');

function oneOnOneFixture({ attackSide = 'home', keeperProfile = 90, carrierDistance = 6, covered = false,
  carrierAge = 0, ballAge = 0, owner = true, airborne = false, unseen = false, ownerConfidence = 0.96,
  carrierY = 34, mutateHidden = false } = {}) {
  const match = TF.createMatch({ seed: 61121, halfSeconds: 90, matchId: `keeper-1v1-${attackSide}-${keeperProfile}-${carrierDistance}-${covered}-${carrierAge}-${ballAge}-${owner}-${airborne}-${unseen}-${ownerConfidence}-${carrierY}` });
  match.state.phase = 'open-play';
  const attackTeam = match.teams.find(t => t.side === attackSide), defendTeam = match.teams.find(t => t !== attackTeam);
  const keeper = defendTeam.activePlayers.find(p => p.isGoalkeeper);
  const carrier = attackTeam.activePlayers.find(p => p.positionFamily === 'FWD');
  const dir = defendTeam.attackDirection, ownX = dir > 0 ? 0 : match.pitch.length;
  const tick = noScanTick(keeper, match, 240);
  match.tick = tick; match.clock.elapsedSeconds = tick * TF.FIXED_DT;
  const carrierPos = { x: ownX + dir * carrierDistance, y: carrierY };
  const ballPos = { x: carrierPos.x - dir * 0.43, y: carrierPos.y, z: airborne ? 0.8 : 0.11 };
  keeper.position = keeper.previousPosition = { x: ownX + dir * 2, y: 34, z: 0 };
  keeper.velocity.x = keeper.velocity.y = 0; keeper.facing = { x: -dir, y: 0 };
  keeper.attributes.oneOnOne = keeperProfile;
  keeper.ai = { nextDecision: tick, lastDecision: tick - 10 };
  carrier.position = carrier.previousPosition = { ...carrierPos, z: 0 };
  carrier.velocity.x = carrier.velocity.y = 0; carrier.facing = { x: -dir, y: 0 };
  carrier.ai = { nextDecision: tick + 100, lastDecision: tick };
  for (const p of match.players) {
    p.velocity.x = p.velocity.y = 0;
    p.intent = p.motor = p.currentAction = { type: 'hold', action: 'hold', target: { x: p.position.x, y: p.position.y }, desiredSpeed: 0, expiresTick: tick + 100 };
  }
  // Keep the carrier's role, facing, and actual location stable when placing
  // teammates/defenders, then make explicit local observations for the keeper.
  carrier.position = carrier.previousPosition = { ...carrierPos, z: 0 };
  const keeperPos = { ...keeper.position };
  const entities = {};
  for (const p of defendTeam.activePlayers) {
    if (p === keeper) continue;
    const point = covered && /CB|LCB|RCB|centre|centerback/i.test(String(p.role || ''))
      ? { x: carrierPos.x - dir * 2.5, y: 34 } : { x: ownX + dir * 24, y: p.position.y };
    p.position = p.previousPosition = { x: point.x, y: point.y, z: 0 };
    entities[p.id] = identityBelief(p, tick, { position: point, ageTicks: 0 });
  }
  for (const p of attackTeam.activePlayers) {
    if (p === carrier) continue;
    p.position = p.previousPosition = { x: ownX + dir * 35, y: 8 + (Number(p.number) % 8) * 7, z: 0 };
    entities[p.id] = identityBelief(p, tick, { ageTicks: 0 });
  }
  const ownerBelief = identityBelief(carrier, tick, { position: carrierPos, ageTicks: carrierAge, confidence: ownerConfidence, facing: { x: -dir, y: 0 } });
  entities[carrier.id] = ownerBelief;
  keeper.beliefState = { entities, updatedTick: tick, lastScanTick: tick, observations: [], ball: {
    position: { ...ballPos }, estimatedPosition: { x: ballPos.x, y: ballPos.y },
    velocity: { x: 0, y: 0, z: 0 }, estimatedZ: airborne ? 0.8 : 0.11, estimatedVelocityZ: 0,
    ownerId: owner && !unseen ? carrier.id : null, lastTouchPlayerId: owner && !unseen ? carrier.id : null,
    lastTouchTeamId: attackTeam.id, confidence: unseen ? 0.2 : 0.97, baseConfidence: 0.97,
    observedTick: tick - ballAge, ageTicks: ballAge, source: unseen ? 'memory' : 'vision'
  } };
  match.ball.ownerId = owner ? carrier.id : null; match.ball.handControl = false; match.ball.controlState = owner ? 'controlled' : 'loose';
  match.ball.position = { ...ballPos }; match.ball.previousPosition = { ...ballPos };
  match.ball.velocity = { x: 0, y: 0, z: 0 }; match.ball.lastTouchTeamId = attackTeam.id; match.ball.lastTouchPlayerId = carrier.id;
  if (mutateHidden) {
    for (const p of defendTeam.activePlayers) {
      if (p !== keeper && p.positionFamily === 'DEF') {
        p.position.x = ownX + dir * 45; p.position.y = 2; p.facing = { x: dir, y: 0 };
      }
    }
  }
  return { match, keeper, carrier, defendTeam, attackTeam, dir, ownX, keeperPos, carrierPos };
}
function decideOneOnOne(f) {
  TF.updateAI(f.match, TF.FIXED_DT);
  return f.keeper.ai.decisionExplanation;
}
function keeperHold(scene) { return scene.candidates.find(c => c.type === 'hold' && c.details.keeper); }

for (const attackSide of ['home', 'away']) {
  const high = oneOnOneFixture({ attackSide, keeperProfile: 95 });
  const highDecision = decideOneOnOne(high), highHold = keeperHold(highDecision);
  assert.equal(highDecision.selected.type, 'hold', `${attackSide}: one-on-one response should remain a normal hold position`);
  assert.equal(highHold.details.oneOnOneNarrowing, true, `${attackSide}: local clear 1v1 failed to add bounded narrowing`);
  assert.ok(highHold.details.oneOnOneNarrowingDepth > 1.5 && highHold.target.x > 0,
    `${attackSide}: keeper profile did not make a measurable geometry change`);
  assert.equal(highDecision.selected.type === 'save' || highDecision.selected.type === 'dive', false,
    `${attackSide}: keeper dived before the physical shot existed`);

  const low = oneOnOneFixture({ attackSide, keeperProfile: 20 });
  const lowHold = keeperHold(decideOneOnOne(low));
  assert.equal(lowHold.details.oneOnOneNarrowing, false, `${attackSide}: low one-on-one profile got the same narrowing behavior`);
  assert.ok(Math.abs(highHold.target.y - lowHold.target.y) > 0.2 || Math.abs(highHold.target.x - lowHold.target.x) > 1,
    `${attackSide}: one-on-one attribute did not affect the keeper's bounded position`);

  const covered = oneOnOneFixture({ attackSide, keeperProfile: 95, covered: true });
  assert.equal(keeperHold(decideOneOnOne(covered)).details.oneOnOneNarrowing, false,
    `${attackSide}: keeper displaced the local defender already covering the shot corridor`);
  for (const negative of [
    oneOnOneFixture({ attackSide, keeperProfile: 95, carrierAge: 25 }),
    oneOnOneFixture({ attackSide, keeperProfile: 95, ballAge: 25 }),
    oneOnOneFixture({ attackSide, keeperProfile: 95, owner: false }),
    oneOnOneFixture({ attackSide, keeperProfile: 95, airborne: true }),
    oneOnOneFixture({ attackSide, keeperProfile: 95, carrierY: attackSide === 'home' ? 50 : 18 }),
    oneOnOneFixture({ attackSide, keeperProfile: 95, ownerConfidence: 0.45 }),
    oneOnOneFixture({ attackSide, keeperProfile: 95, unseen: true })
  ]) assert.equal(keeperHold(decideOneOnOne(negative)).details.oneOnOneNarrowing, false,
    `${attackSide}: stale, airborne, ownerless, or uncertain belief produced a pre-shot narrowing`);

  const hiddenA = oneOnOneFixture({ attackSide, keeperProfile: 95 });
  const hiddenB = oneOnOneFixture({ attackSide, keeperProfile: 95, mutateHidden: true });
  const a = keeperHold(decideOneOnOne(hiddenA)), b = keeperHold(decideOneOnOne(hiddenB));
  assert.deepEqual(b.target, a.target, `${attackSide}: keeper position read unobserved defender truth`);
  assert.equal(b.details.oneOnOneNarrowingDepth, a.details.oneOnOneNarrowingDepth,
    `${attackSide}: keeper narrowing utility read hidden defender state`);
}

// The response is a movement target, not a save: run ordinary physics from
// the selected intent and verify the keeper begins moving without a dive or
// any authored possession change.
{
  const scene = oneOnOneFixture({ attackSide: 'home', keeperProfile: 95 });
  const explanation = decideOneOnOne(scene), initial = { ...scene.keeper.position };
  const ownerBefore = scene.match.ball.ownerId;
  for (let i = 0; i < 48; i++) {
    TF.updatePhysics(scene.match, TF.FIXED_DT);
    scene.match.tick++;
    scene.match.clock.elapsedSeconds += TF.FIXED_DT;
  }
  assert.equal(scene.keeper.intent.type, 'hold', 'keeper changed to a pre-release save/dive during the movement suffix');
  assert.ok(Math.hypot(scene.keeper.position.x - initial.x, scene.keeper.position.y - initial.y) > 0.12,
    'ordinary keeper motor did not move toward the narrowed hold target');
  assert.equal(scene.match.ball.ownerId, ownerBefore, 'keeper positioning fixture forced a pre-shot ball contact');
  assert.ok(!scene.match.events.some(e => e.type === 'save' || e.type === 'keeper-collection' || e.type === 'keeper-punch'),
    'movement-only suffix emitted a save or contact without a shot/contact opportunity');
  assert.ok(explanation.selected.target && Number.isFinite(explanation.selected.target.x));
}

process.stdout.write('keeper foot-possession risk uses own-goal exposure and viable local outlets; 1v1 narrowing is profile-scaled, mirrored, belief-led, and movement-only\n');
