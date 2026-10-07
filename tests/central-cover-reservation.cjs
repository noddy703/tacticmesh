const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/tactics.js');
require('../src/intelligence.js');
require('../src/physics.js');
require('../src/rules.js');

const TF = globalThis.TF;
const dt = TF.FIXED_DT;
const centerY = 34;

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < String(text).length; i += 1) { value ^= String(text).charCodeAt(i); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

function makeThreat(defendingSide, options = {}) {
  const seed = options.seed || (defendingSide === 'away' ? 41001 : 41002);
  const match = TF.createMatch({ seed, homeFormation: '4-3-3', awayFormation: '4-3-3' });
  const defending = match.teams.find(team => team.side === defendingSide);
  const attacking = match.teams.find(team => team !== defending);
  defending.tactics.pressingIntensity = 0.5;
  const defendDir = defending.attackDirection;
  const towardGoal = -defendDir;
  const ownGoalX = defendDir > 0 ? 0 : match.pitch.length;
  const depth = options.depth == null ? 20 : options.depth;
  const carrierY = options.carrierY == null ? centerY : options.carrierY;
  const role = (team, code) => team.activePlayers.find(player => player.role === code);
  const place = (player, playerDepth, y) => {
    player.position.x = ownGoalX + defendDir * playerDepth;
    player.position.y = y;
    player.previousPosition.x = player.position.x;
    player.previousPosition.y = y;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.facing.x = towardGoal;
    player.facing.y = 0;
    // formationSlot.x is stored in attack-direction coordinates. Keep the
    // same role depth when the fixture is mirrored to the other end.
    player.formationSlot = Object.assign({}, player.formationSlot, { x: ownGoalX + defendDir * playerDepth, y });
    player.intent = null;
    player.motor = null;
    return player;
  };

  const carrier = role(attacking, 'RW');
  const lcb = role(defending, 'LCB');
  const rcb = role(defending, 'RCB');
  const dm = role(defending, 'DM');
  const keeper = role(defending, 'GK');
  const runner = role(attacking, 'ST');
  const wide = role(attacking, 'LW');
  const runnerY = options.runnerY == null ? 46 : options.runnerY;
  const wideY = options.wideY == null ? 9 : options.wideY;
  place(carrier, depth, carrierY);
  carrier.velocity.x = towardGoal * 4;
  carrier.hasBall = true;
  place(lcb, 12, carrierY - 3.5);
  place(rcb, 13, carrierY + 7.5);
  if (options.wideCandidateControl) {
    // Keep one CB wide and field-side as the unavailable-to-cover negative;
    // the other starts goal-side with a >5.5m lateral route to the lane.
    place(lcb, 26, carrierY - 10);
    place(rcb, 13, carrierY + 5.6);
  }
  // In the isolated wide-CB arrival control, keep the still-assigned presser
  // beyond the physical challenge window so this test measures CB lane arrival
  // rather than allowing the separate presser to end the attack first.
  place(dm, options.isolateCoverMovement ? 45 : 16, options.isolateCoverMovement ? 2 : carrierY - 0.7);
  if (options.unavailableNearCB) lcb.active = false;
  place(keeper, 1.5, centerY);
  place(runner, depth - 3, runnerY);
  place(wide, depth + 4, wideY);

  for (const [index, player] of defending.activePlayers.entries()) {
    if ([lcb, rcb, dm, keeper].includes(player)) continue;
    place(player, 15 + (index % 3) * 4, 12 + (index * 8) % 44);
  }
  for (const [index, player] of attacking.activePlayers.entries()) {
    if ([carrier, runner, wide].includes(player) || player.isGoalkeeper) continue;
    place(player, depth + 12 + (index % 3) * 3, 18 + (index * 6) % 34);
  }

  match.ball.ownerId = carrier.id;
  match.ball.position.x = carrier.position.x + towardGoal * 0.35;
  match.ball.position.y = carrier.position.y;
  match.ball.position.z = 0.11;
  match.ball.velocity.x = towardGoal * 4;
  match.ball.velocity.y = 0;
  match.ball.velocity.z = 0;
  const observedCarrier = {
    x: carrier.position.x, y: carrier.position.y,
    velocity: { x: carrier.velocity.x, y: carrier.velocity.y },
    facing: { x: carrier.facing.x, y: carrier.facing.y }
  };
  const observedBall = { x: match.ball.position.x, y: match.ball.position.y };
  if (options.hiddenCarrierWorldShift) {
    carrier.position.x += options.hiddenCarrierWorldShift.x || 0;
    carrier.position.y += options.hiddenCarrierWorldShift.y || 0;
    match.ball.position.x += options.hiddenCarrierWorldShift.x || 0;
    match.ball.position.y += options.hiddenCarrierWorldShift.y || 0;
  }
  match.state.phase = 'open-play';
  match.state.restartType = null;
  match.state.restartTeamId = null;
  match.tick = 15;

  for (const observer of match.players) {
    const entities = {};
    for (const other of match.players) {
      if (other === observer) continue;
      const point = other === carrier ? { x: observedCarrier.x, y: observedCarrier.y } : { x: other.position.x, y: other.position.y };
      entities[other.id] = {
        id: other.id,
        teamId: other.teamId,
        role: other.role,
        position: point,
        estimatedPosition: point,
        velocity: other === carrier ? Object.assign({}, observedCarrier.velocity) : { x: other.velocity.x, y: other.velocity.y },
        facing: other === carrier ? Object.assign({}, observedCarrier.facing) : { x: other.facing.x, y: other.facing.y },
        confidence: options.entityConfidence == null ? 0.96 : options.entityConfidence,
        ageTicks: options.entityAge == null ? 0 : options.entityAge,
        observedTick: match.tick,
        source: 'vision'
      };
    }
    const ballPoint = { x: observedBall.x, y: observedBall.y };
    observer.beliefState = {
      entities,
      updatedTick: match.tick,
      lastScanTick: match.tick,
      observations: [],
      ball: {
        position: { x: ballPoint.x, y: ballPoint.y, z: 0.11 },
        estimatedPosition: { x: ballPoint.x, y: ballPoint.y },
        velocity: { x: carrier.velocity.x, y: carrier.velocity.y, z: 0 },
        estimatedZ: 0.11,
        estimatedVelocityZ: 0,
        confidence: options.ballConfidence == null ? 0.96 : options.ballConfidence,
        baseConfidence: 0.96,
        ageTicks: options.ballAge == null ? 0 : options.ballAge,
        observedTick: match.tick,
        ownerId: options.ownerId === undefined ? carrier.id : options.ownerId,
        lastTouchTeamId: attacking.id
      }
    };
    observer.ai = { nextDecision: match.tick, lastDecision: match.tick - 12 };
  }
  if (options.hiddenFarCBWorldShift) {
    rcb.position.x += options.hiddenFarCBWorldShift.x || 0;
    rcb.position.y += options.hiddenFarCBWorldShift.y || 0;
  }
  if (options.hiddenFarCBFacing) {
    rcb.facing.x = options.hiddenFarCBFacing.x;
    rcb.facing.y = options.hiddenFarCBFacing.y;
  }
  let evaluationTick = match.tick + 1;
  for (; evaluationTick < 300; evaluationTick += 1) {
    const scans = match.players.some(player => {
      const interval = TF.getPerceptionScanInterval(player, match);
      return (evaluationTick + hash(player.id)) % interval === 0;
    });
    if (!scans) break;
  }
  match.tick = evaluationTick;
  for (const player of match.players) {
    player.beliefState.updatedTick = evaluationTick;
    player.beliefState.lastScanTick = evaluationTick;
    if (player.beliefState.ball) player.beliefState.ball.observedTick = evaluationTick;
    for (const entity of Object.values(player.beliefState.entities)) entity.observedTick = evaluationTick;
    player.ai.nextDecision = evaluationTick;
    player.ai.lastDecision = evaluationTick - 12;
  }
  if (options.missingTimestamps) {
    for (const observer of match.players) {
      if (observer.beliefState.ball) {
        delete observer.beliefState.ball.ageTicks;
        delete observer.beliefState.ball.observedTick;
      }
      for (const entity of Object.values(observer.beliefState.entities)) {
        delete entity.ageTicks;
        delete entity.observedTick;
      }
    }
  }
  return { match, defending, attacking, carrier, lcb, rcb, dm, keeper, runner, wide, ownGoalX, defendDir, towardGoal };
}

function lineDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length2));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function evaluate(defendingSide, options = {}) {
  const fixture = makeThreat(defendingSide, options);
  const { match, defending, carrier, lcb, rcb, dm, ownGoalX } = fixture;
  TF.updateTactics(match, dt);
  TF.updateAI(match, dt);
  const contexts = new Map([lcb, rcb, dm].map(player => [player.id, TF.getTacticalContext(match, player)]));
  const assignments = defending._tacticalState && defending._tacticalState.pressAssignments || {};
  const pressers = assignments[carrier.id] || [];
  const rayGoal = { x: ownGoalX, y: centerY };
  const rayDistances = {
    lcb: lineDistance(lcb.intent && lcb.intent.target || lcb.position, carrier.position, rayGoal),
    rcb: lineDistance(rcb.intent && rcb.intent.target || rcb.position, carrier.position, rayGoal)
  };
  return Object.assign(fixture, { contexts, pressers, rayDistances });
}

function liveTimeToLane(match, team, player, farCB, carrier, ownGoalX) {
  const samples = {};
  let stop = 'tick-limit';
  const thresholds = [16, 12, 8, 6];
  for (let ticks = 1; ticks <= 360; ticks += 1) {
    match.tick += 1;
    TF.updateTactics(match, dt);
    TF.updateAI(match, dt);
    // Keep the threat as a physical, controlled ball-carrier so the deadline
    // cannot be met merely because the autonomous attacker chooses a pass.
    // The defending side remains fully AI-driven; no contact or goal is forced.
    carrier.intent = { type: 'carry', target: { x: ownGoalX, y: carrier.position.y }, desiredSpeed: 0.72, expiresTick: match.tick + 12 };
    carrier.motor = carrier.intent;
    TF.updateWorld(match, dt);
    const carrierDepth = Math.abs(carrier.position.x - ownGoalX);
    const laneGap = lineDistance(player.position, carrier.position, { x: ownGoalX, y: centerY });
    thresholds.forEach(depth => {
      if (!samples[depth] && carrierDepth <= depth) {
        const assignments = team._tacticalState && team._tacticalState.pressAssignments || {};
        const lanes = team._tacticalState && team._tacticalState.centralLaneAssignments || {};
        const context = TF.getTacticalContext(match, player);
        samples[depth] = {
          ticks, seconds: Number((ticks * dt).toFixed(3)), carrierDepth: Number(carrierDepth.toFixed(2)),
          carrier: { x: Number(carrier.position.x.toFixed(2)), y: Number(carrier.position.y.toFixed(2)) },
          laneGap: Number(laneGap.toFixed(2)), intent: player.intent && player.intent.type,
          assignedCB: { x: Number(player.position.x.toFixed(2)), y: Number(player.position.y.toFixed(2)), target: player.intent && player.intent.target ? { x: Number(player.intent.target.x.toFixed(2)), y: Number(player.intent.target.y.toFixed(2)) } : null },
          coverAssignment: lanes[carrier.id] || null,
          pressers: (assignments[carrier.id] || []).slice(),
          farCB: { intent: farCB.intent && farCB.intent.type, y: Number(farCB.position.y.toFixed(2)), targetY: farCB.intent && farCB.intent.target ? Number(farCB.intent.target.y.toFixed(2)) : null },
          ownerId: match.ball.ownerId, phase: match.state && match.state.phase,
          centralResponsibility: !!(context.responsibilities && context.responsibilities.centralShotLane)
        };
      }
    });
    if (carrierDepth <= 6) { stop = 'carrier-reached-6m'; break; }
    if (match.ball.ownerId !== carrier.id) { stop = 'physical-possession-interruption'; break; }
    if (match.state && (match.state.phase !== 'open-play' || match.state.restartType)) { stop = 'restart-or-phase-interruption'; break; }
  }
  return {
    ticks: match.tick, stop, samples,
    carrierDepth: Math.abs(carrier.position.x - ownGoalX),
    laneGap: lineDistance(player.position, carrier.position, { x: ownGoalX, y: centerY }),
    ownerId: match.ball.ownerId, intent: player.intent && player.intent.type
  };
}

// Goal two from the frozen generated-default seed 20261014 is used here as a
// live, mirrored geometry fixture. At release, the central carrier was 23.75m
// from goal; the RCB's communicated lane target was 8.88m away but reachable
// before the carrier's close-time deadline. The LCB was 7.97m away but arrived
// too late, so it remains a useful width-preserving negative control.
function makeGoalTwoSnapshot(defendingSide) {
  const match = TF.createMatch({ seed: 20261014, homeFormation: '4-3-3', awayFormation: '4-2-3-1' });
  const defending = match.teams.find(team => team.side === defendingSide);
  const attacking = match.teams.find(team => team !== defending);
  // The recorded second-half attack was toward x=0. Mirror all x geometry and
  // headings for the other end while preserving the same roles and attributes.
  const defendDir = defendingSide === 'away' ? 1 : -1;
  const ownGoalX = defendDir > 0 ? 0 : match.pitch.length;
  defending.attackDirection = defendDir;
  attacking.attackDirection = -defendDir;
  const carrier = attacking.activePlayers.find(player => player.role === 'LW');
  const nearCB = defending.activePlayers.find(player => player.role === 'RCB');
  const farCB = defending.activePlayers.find(player => player.role === 'LCB');
  const presser = defending.activePlayers.find(player => player.role === 'DM' && /p07$/.test(player.id))
    || defending.activePlayers.find(player => player.role === 'DM');
  const mirrorX = x => defendDir > 0 ? x : match.pitch.length - x;
  const mirrorVx = x => defendDir > 0 ? x : -x;
  const put = (player, values) => {
    player.position.x = mirrorX(values.x);
    player.position.y = values.y;
    player.previousPosition.x = player.position.x;
    player.previousPosition.y = player.position.y;
    player.velocity.x = mirrorVx(values.vx || 0);
    player.velocity.y = values.vy || 0;
    player.facing.x = mirrorVx(values.fx == null ? defendDir : values.fx);
    player.facing.y = values.fy || 0;
    player.intent = null;
    player.motor = null;
  };
  put(carrier, { x: 23.816, y: 27.737, vx: -4.592, vy: 3.662, fx: -0.916, fy: 0.398 });
  put(nearCB, { x: 21.919, y: 40.796, vx: -2.055, vy: 0.534, fx: 0.183, fy: -0.983 });
  put(farCB, { x: 25.508, y: 23.867, vx: -0.502, vy: 0.475, fx: -0.599, fy: 0.8 });
  put(presser, { x: 27.52, y: 22.939, vx: -2.809, vy: 3.453, fx: -0.592, fy: 0.806 });
  carrier.hasBall = true;
  match.ball.ownerId = carrier.id;
  match.ball.position.x = mirrorX(23.752);
  match.ball.position.y = 27.672;
  match.ball.position.z = 0.11;
  match.ball.velocity.x = mirrorVx(-4.783);
  match.ball.velocity.y = 3.760;
  match.ball.velocity.z = 0;
  match.state.phase = 'open-play';
  match.state.restartType = null;
  match.state.restartTeamId = null;
  match.state.period = 2;
  match.tick = 176250;
  defending.tactics.pressingIntensity = 0.5;
  for (const observer of match.players) {
    const entities = {};
    for (const other of match.players) {
      if (other === observer) continue;
      entities[other.id] = {
        id: other.id,
        teamId: other.teamId,
        role: other.role,
        position: { x: other.position.x, y: other.position.y },
        estimatedPosition: { x: other.position.x, y: other.position.y },
        velocity: { x: other.velocity.x, y: other.velocity.y },
        facing: { x: other.facing.x, y: other.facing.y },
        confidence: 0.907,
        ageTicks: 3,
        observedTick: match.tick - 3,
        source: 'vision'
      };
    }
    observer.beliefState = {
      entities,
      updatedTick: match.tick - 3,
      lastScanTick: match.tick - 3,
      observations: [],
      ball: {
        position: { x: match.ball.position.x, y: match.ball.position.y, z: 0.11 },
        estimatedPosition: { x: match.ball.position.x, y: match.ball.position.y },
        velocity: { x: match.ball.velocity.x, y: match.ball.velocity.y, z: 0 },
        estimatedZ: 0.11,
        estimatedVelocityZ: 0,
        confidence: 0.88,
        baseConfidence: 0.88,
        ageTicks: 3,
        observedTick: match.tick - 3,
        ownerId: carrier.id,
        lastTouchTeamId: attacking.id
      }
    };
    observer.ai = { nextDecision: match.tick, lastDecision: match.tick - 12 };
  }
  // Keep the recorded independent DM press responsibility; the lane CB is
  // explicitly not a presser and the far CB remains available for width.
  defending._tacticalState = {
    phase: 'organizedDefensiveBlock', phaseWeights: {}, updatedTick: -1,
    pressAssignments: { [carrier.id]: [presser.id] }, centralLaneAssignments: {}, markAssignments: {}
  };
  return { match, defending, attacking, carrier, nearCB, farCB, presser, ownGoalX, defendDir };
}

const snapshotEvidence = [];
const wideMovementEvidence = [];
for (const side of ['away', 'home']) {
  const fixture = makeGoalTwoSnapshot(side);
  const { match, defending, carrier, nearCB, farCB, presser, ownGoalX } = fixture;
  TF.updateTactics(match, dt);
  TF.updateAI(match, dt);
  const assignment = defending._tacticalState.centralLaneAssignments[carrier.id];
  const pressers = defending._tacticalState.pressAssignments[carrier.id] || [];
  assert.equal(assignment, undefined, `${side}: goal-two snapshot must reject the RCB whose predicted deadline failed in live movement`);
  assert.deepEqual(pressers, [presser.id], `${side}: lane cover changed the independent one-player press reservation`);
  assert.equal(farCB.intent.type, 'recover', `${side}: the nonassigned CB should retain its recovery/width role`);
  assert.ok(Math.abs(farCB.intent.target.y - centerY) > 5, `${side}: the far-side LCB was pulled into the central lane`);
  const live = liveTimeToLane(match, defending, nearCB, farCB, carrier, ownGoalX);
  assert.ok(live.stop === 'carrier-reached-6m' || live.stop === 'physical-possession-interruption',
    `${side}: live snapshot approach must continue to six metres or stop on genuine possession (${JSON.stringify(live)})`);
  assert.ok(live.samples[6], `${side}: the exact snapshot should be followed through to the six-metre deadline`);
  assert.ok(live.samples[6].laneGap > 2.5, `${side}: test fixture should reproduce the physically late RCB, not imply a successful cover`);
  snapshotEvidence.push({ side, rejectedUnreachable: nearCB.id, preservedWideCB: farCB.id, liveStop: live.stop, finalGap: live.samples[6].laneGap, samples: live.samples });
}

for (const side of ['away', 'home']) {
  const fixture = evaluate(side, { wideCandidateControl: true, isolateCoverMovement: true });
  const { match, defending, carrier, lcb, rcb, ownGoalX, pressers } = fixture;
  TF.updateTactics(match, dt);
  TF.updateAI(match, dt);
  const assignment = defending._tacticalState.centralLaneAssignments[carrier.id];
  assert.ok(assignment, `${side}: a genuinely reachable wide CB should be eligible without the 5.5m lateral cap`);
  assert.equal(assignment.playerId, rcb.id, `${side}: only the goal-side RCB should receive the central cover responsibility`);
  const lateralGap = Math.abs(rcb.position.y - assignment.target.y);
  assert.ok(lateralGap > 5.5, `${side}: the positive control must exceed the removed lateral cap`);
  assert.equal(pressers.length, 1, `${side}: the wide-CB positive control must retain a single independent presser`);
  assert.equal(lcb.intent.type, 'recover', `${side}: the late field-side LCB should stay wide`);
  assert.ok(Math.abs(lcb.intent.target.y - centerY) > 5, `${side}: the LCB lost far-side width in the positive control`);
  const before = { x: rcb.position.x, y: rcb.position.y };
  const live = liveTimeToLane(match, defending, rcb, lcb, carrier, ownGoalX);
  assert.equal(live.stop, 'carrier-reached-6m', `${side}: positive-control carrier should reach six metres without forced contact (${JSON.stringify(live)})`);
  for (const depth of [6]) {
    const sample = live.samples[depth];
    assert.ok(sample, `${side}: positive control missed its ${depth}m sample (${JSON.stringify(live)})`);
    assert.ok(sample.laneGap <= 2.5, `${side}: timely CB failed to occupy the lane at ${depth}m (${JSON.stringify(sample)})`);
    assert.equal(sample.pressers.length, 1, `${side}: live positive control changed the press cap`);
    assert.ok(!sample.pressers.includes(rcb.id), `${side}: the lane CB displaced the presser`);
    assert.equal(sample.farCB.intent, 'recover', `${side}: far-side LCB abandoned width in the live control`);
  }
  assert.ok(Math.hypot(rcb.position.x - before.x, rcb.position.y - before.y) > 1,
    `${side}: positive central cover must result from motor movement`);
  wideMovementEvidence.push({ side, coverId: assignment.playerId, lateralGap, arrivalTime: assignment.arrivalTime, closeTime: assignment.closeTime, liveStop: live.stop, samples: live.samples });
}

const movementEvidence = [];
for (const side of ['away', 'home']) {
  const fixture = evaluate(side);
  const { defending, carrier, lcb, rcb, ownGoalX, contexts, pressers, rayDistances } = fixture;
  assert.equal(pressers.length, 1, `${side}: central cover fixture must preserve the configured one-presser cap`);
  assert.ok(!pressers.includes(lcb.id) && !pressers.includes(rcb.id), `${side}: a CB displaced the reserved presser`);
  assert.equal(contexts.get(lcb.id).responsibilities.press, false, `${side}: CB should not take the press reservation`);
  assert.equal(contexts.get(lcb.id).responsibilities.centralShotLane, true, `${side}: nearest CB was not assigned communicated central-lane cover`);
  assert.ok(rayDistances.lcb < rayDistances.rcb, `${side}: setup must give the near CB a better corridor arrival path`);
  assert.ok(rayDistances.lcb < 2.5, `${side}: near CB must be able to enter the central shooting corridor before the carrier closes`);
  assert.ok(rayDistances.rcb > 4, `${side}: far-side CB must retain runner/width coverage`);
  assert.equal(lcb.intent.type, 'cover', `${side}: reachable nearest CB did not choose a distinct central-lane cover intent`);
  assert.equal(lcb.intent.details.runnerId, fixture.runner.id, `${side}: the communicated lane reservation lost the far-side runner identity`);
  assert.equal(rcb.intent.type, 'recover', `${side}: far-side CB was pulled into the central-lane assignment`);
  assert.ok(Math.abs(rcb.intent.target.y - centerY) > 3, `${side}: far-side recovery collapsed toward the central lane`);
  assert.ok(contexts.get(rcb.id).responsibilities.markTargetId === fixture.runner.id || Math.abs(rcb.intent.target.y - fixture.runner.position.y) < 8,
    `${side}: far-side CB lost both runner assignment and runner-side width`);
  const lanePoint = Object.assign({}, lcb.intent.target);
  const time = liveTimeToLane(fixture.match, defending, lcb, rcb, carrier, ownGoalX);
  assert.equal(time.stop, 'carrier-reached-6m', `${side}: the carrier should reach the near-goal sampling point without forced contact/restart (${JSON.stringify(time)})`);
  for (const depth of [12, 8, 6]) {
    const sample = time.samples[depth];
    assert.ok(sample, `${side}: the live approach missed its ${depth}m sample (${JSON.stringify(time)})`);
    assert.ok(sample.coverAssignment && sample.coverAssignment.playerId === lcb.id || sample.laneGap <= 2.5,
      `${side}: the reachable lane responsibility was dropped before the center-back reached and held the lane at ${depth}m (${JSON.stringify(sample)})`);
    assert.ok(sample.centralResponsibility || sample.laneGap <= 2.5, `${side}: the assigned center-back lost its local lane responsibility before physically occupying the lane at ${depth}m`);
    assert.ok(sample.laneGap <= 2.5, `${side}: the center-back left the direct goal ray at ${depth}m (${JSON.stringify(sample)})`);
    const targetDepth = Math.abs(sample.assignedCB.target.x - ownGoalX);
    assert.ok(targetDepth < sample.carrierDepth, `${side}: the near center-back's actual movement target was not goal-side at ${depth}m (${JSON.stringify(sample)})`);
    assert.equal(sample.pressers.length, 1, `${side}: follow-through changed the configured press cap at ${depth}m`);
    assert.ok(!sample.pressers.includes(lcb.id), `${side}: the lane defender replaced the independent presser at ${depth}m`);
    assert.equal(sample.farCB.intent, 'recover', `${side}: follow-through pulled the far CB away from width at ${depth}m`);
    assert.ok(Math.abs(sample.farCB.targetY - centerY) > 3, `${side}: the far CB collapsed toward the central lane at ${depth}m`);
  }
  movementEvidence.push({ side, target: lanePoint, stop: time.stop, samples: time.samples });
}

for (const side of ['away', 'home']) {
  const stale = evaluate(side, { ballAge: 24, entityAge: 24 });
  assert.ok(!stale.defending._tacticalState.centralLaneAssignments[stale.carrier.id], `${side}: stale local observations created a central cover reservation`);
  const lowConfidence = evaluate(side, { ballConfidence: 0.31, entityConfidence: 0.31 });
  assert.ok(!lowConfidence.defending._tacticalState.centralLaneAssignments[lowConfidence.carrier.id], `${side}: low-confidence observations created a central cover reservation`);
  const lowBallConfidence = evaluate(side, { ballConfidence: 0.31 });
  assert.ok(!lowBallConfidence.defending._tacticalState.centralLaneAssignments[lowBallConfidence.carrier.id], `${side}: low-confidence ball observation created a central cover reservation`);
  const invalidConfidence = evaluate(side, { ballConfidence: NaN, entityConfidence: NaN });
  assert.ok(!invalidConfidence.defending._tacticalState.centralLaneAssignments[invalidConfidence.carrier.id], `${side}: non-finite local confidence created a central cover reservation`);
  const missingTime = evaluate(side, { missingTimestamps: true });
  assert.ok(!missingTime.defending._tacticalState.centralLaneAssignments[missingTime.carrier.id], `${side}: missing observation timestamps were treated as fresh`);
  const wide = evaluate(side, { carrierY: 10 });
  assert.ok(!wide.defending._tacticalState.centralLaneAssignments[wide.carrier.id], `${side}: wide carrier created a central cover reservation`);
  const midfield = evaluate(side, { depth: 38 });
  assert.ok(!midfield.defending._tacticalState.centralLaneAssignments[midfield.carrier.id], `${side}: midfield carrier created a central cover reservation`);
  const unseen = evaluate(side, { ownerId: null });
  assert.ok(!unseen.defending._tacticalState.centralLaneAssignments || !unseen.defending._tacticalState.centralLaneAssignments[unseen.carrier.id], `${side}: unowned ball created a carrier-lane reservation`);
  const unavailable = evaluate(side, { unavailableNearCB: true });
  assert.ok(!unavailable.defending._tacticalState.centralLaneAssignments[unavailable.carrier.id], `${side}: unavailable near CB caused the far-side runner defender to abandon width`);
  const noPress = evaluate(side);
  noPress.defending._tacticalState.pressAssignments[noPress.carrier.id] = [];
  assert.equal(TF.getTacticalContext(noPress.match, noPress.lcb).responsibilities.centralShotLane, false, `${side}: lane coverage remained active after the independent press reservation was removed`);
}

for (const side of ['away', 'home']) {
  const perceivedMatch = evaluate(side, { seed: side === 'away' ? 41501 : 41502 });
  const hiddenWorldMoved = evaluate(side, { seed: side === 'away' ? 41501 : 41502, hiddenCarrierWorldShift: { x: 2.5, y: -11 } });
  const hiddenFarCBMoved = evaluate(side, { seed: side === 'away' ? 41501 : 41502, hiddenFarCBWorldShift: { x: 3, y: 10 }, hiddenFarCBFacing: { x: -1, y: 0.6 } });
  assert.deepEqual(perceivedMatch.defending._tacticalState.centralLaneAssignments, hiddenWorldMoved.defending._tacticalState.centralLaneAssignments,
    `${side}: central cover assignment changed when only hidden physical carrier/ball state moved`);
  assert.deepEqual(perceivedMatch.lcb.intent.target, hiddenWorldMoved.lcb.intent.target,
    `${side}: cover target read hidden carrier location instead of local belief`);
  assert.deepEqual(perceivedMatch.defending._tacticalState.centralLaneAssignments, hiddenFarCBMoved.defending._tacticalState.centralLaneAssignments,
    `${side}: cover assignment read an unobserved teammate's world position or facing`);
}

process.stdout.write(`central shot-lane cover is mirrored, locally observed, and preserves press cap/width: ${JSON.stringify({ snapshotRejection: snapshotEvidence, reachableWideCB: wideMovementEvidence, baselineControl: movementEvidence })}\n`);
