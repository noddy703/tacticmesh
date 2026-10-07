const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/world.js');
require('../src/physics.js');
require('../src/rules.js');
const TF = globalThis.TF;

function fixture(seed, attackingSide) {
  const match = TF.createMatch({ seed, halfSeconds: 90 });
  match.state.phase = 'open-play';
  const attack = match.teams.find(t => t.side === attackingSide);
  const defend = match.teams.find(t => t !== attack);
  const dir = attack.attackDirection;
  const passer = attack.activePlayers[5];
  const receiver = attack.activePlayers[8];
  const priorOpponent = defend.activePlayers[5];
  const ownX = dir > 0 ? 20 : match.pitch.length - 20;
  const receiveX = ownX - dir * 4;
  for (const [index, p] of match.players.entries()) {
    p.position = { x: p.teamId === attack.id ? 31 + index * 0.35 : 72 + index * 0.35, y: 5 + index % 10 * 5.4 };
    p.previousPosition = { ...p.position };
    p.velocity.x = p.velocity.y = 0;
    p.motor = p.intent = p.currentAction = null;
  }
  passer.position = { x: ownX, y: 34 }; passer.previousPosition = { ...passer.position };
  passer.facing = { x: -dir, y: 0 }; passer.rng = { next: () => 0.5 };
  receiver.position = { x: receiveX, y: 34 }; receiver.previousPosition = { ...receiver.position };
  receiver.facing = { x: dir, y: 0 };
  priorOpponent.position = { x: ownX + dir * 5, y: 48 }; priorOpponent.previousPosition = { ...priorOpponent.position };
  for (const p of defend.activePlayers.filter(p => p.isGoalkeeper)) {
    p.position = { x: dir > 0 ? 103 : 2, y: 7 }; p.previousPosition = { ...p.position };
  }
  match.ball.position = { x: ownX - dir * 0.45, y: 34, z: 0.11 };
  match.ball.previousPosition = { ...match.ball.position };
  match.ball.velocity.x = match.ball.velocity.y = match.ball.velocity.z = 0;
  match.ball.ownerId = passer.id; match.ball.controlState = 'controlled'; match.ball.handControl = false;
  // Reproduce the old defect's preceding opponent touch, then issue a real
  // motor-generated through-ball from the actual passer.
  TF.physicsHelpers.addTouch(match, priorOpponent, 'challenge');
  match.ball.ownerId = passer.id; match.ball.controlState = 'controlled';
  passer.motor = passer.intent = passer.currentAction = {
    type: 'throughBall', target: { x: receiveX, y: 34 }, ballTarget: { x: receiveX, y: 34 },
    targetId: receiver.id, power: 0.25, desiredSpeed: 0, createdTick: match.tick
  };
  return { match, attack, defend, passer, receiver, priorOpponent, dir, receiveX };
}

function step(match) {
  match.tick += 1;
  match.clock.elapsedSeconds += TF.FIXED_DT;
  TF.updatePhysics(match, TF.FIXED_DT);
  TF.updateRules(match, TF.FIXED_DT);
}

for (const side of ['home', 'away']) {
  const f = fixture(side === 'home' ? 92011 : 92012, side);
  TF.updatePhysics(f.match, TF.FIXED_DT);
  const launch = f.match.events.find(e => e.type === 'pass');
  assert.ok(launch, `${side} through-ball uses the real strike path`);
  assert.equal(launch.playerId, f.passer.id);
  assert.equal(f.match.ball._passAssistCandidate.passerId, f.passer.id,
    `${side} candidate names the actual passer, not the previous opponent toucher`);
  assert.equal(f.match.ball._passAssistCandidate.targetId, f.receiver.id);
  assert.equal(f.match.ball._passAssistCandidate.receivedById, null,
    'launch alone cannot earn an assist');

  const checkpoint = TF.captureCheckpoint(f.match);
  const restored = TF.createMatch({ seed: side === 'home' ? 92011 : 92012, halfSeconds: 90 });
  TF.restoreCheckpoint(restored, checkpoint);
  f.receiver.rng = { next: () => 0 };
  restored.playersById[f.receiver.id].rng = { next: () => 0 };
  assert.deepEqual(restored.ball._passAssistCandidate, f.match.ball._passAssistCandidate,
    'the unconfirmed pass candidate survives a checkpoint');
  for (let i = 0; i < 40 && f.match.ball.ownerId !== f.receiver.id; i += 1) {
    step(f.match); step(restored);
  }
  assert.equal(f.match.ball.ownerId, f.receiver.id, `${side} receiver physically controls the pass`);
  assert.equal(f.match.ball._passAssistCandidate.receivedById, f.receiver.id,
    'only actual intended-recipient control confirms the candidate');
  assert.deepEqual(restored.ball._passAssistCandidate, f.match.ball._passAssistCandidate);
  assert.deepEqual(restored.events, f.match.events, 'checkpoint suffix preserves the same physical receipt events');

  const goalX = f.dir > 0 ? f.match.pitch.length : 0;
  f.receiver.facing = { x: f.dir, y: 0 };
  f.receiver.motor = f.receiver.intent = f.receiver.currentAction = {
    type: 'shoot', target: { x: goalX, y: 34 }, ballTarget: { x: goalX, y: 34 },
    power: 0.95, desiredSpeed: 0, createdTick: f.match.tick
  };
  TF.updatePhysics(f.match, TF.FIXED_DT);
  assert.ok(f.match.events.some(e => e.type === 'shot' && e.playerId === f.receiver.id),
    `${side} receiver launches a physical shot after control`);
  assert.equal(f.match.ball._assistPlayerId, f.passer.id,
    'the goal-bound shot consumes the confirmed same-team pass receipt');
  const goal = f.match.scoreGoal(f.attack.id, f.receiver.id, f.match.ball._assistPlayerId);
  assert.equal(goal.scorerId, f.receiver.id);
  assert.equal(goal.assistId, f.passer.id);
  assert.equal(f.passer.stats.assists, 1);
  assert.equal(f.priorOpponent.stats.assists || 0, 0);
}

// A targeted lofted pass can be met by the named receiver's physical one-touch
// header. That actual header is eligible to receive the same pass assist even
// before a separate foot-control event occurs.
for (const side of ['home', 'away']) {
  const m = TF.createMatch({ seed: side === 'home' ? 92021 : 92022, halfSeconds: 90 });
  m.state.phase = 'open-play';
  const attack = m.teams.find(t => t.side === side), defend = m.teams.find(t => t !== attack), dir = attack.attackDirection;
  const goalX = dir > 0 ? m.pitch.length : 0, passer = attack.activePlayers[5], receiver = attack.activePlayers[8];
  for (const [index, p] of m.players.entries()) {
    p.position = { x: 50 + index * 0.2, y: p.teamId === attack.id ? 4 + index % 3 * 2 : 4 + index % 3 * 2 };
    p.previousPosition = { ...p.position }; p.velocity.x = p.velocity.y = 0;
    p.motor = p.intent = p.currentAction = null;
  }
  // Keep the last defender goal-side of the receiver so the pass is onside,
  // while all opposing bodies remain away from the central physical lane.
  for (const p of defend.activePlayers) {
    p.position = { x: goalX - dir * 0.45, y: dir > 0 ? 4 : 64 };
    p.previousPosition = { ...p.position };
  }
  const passStart = { x: goalX - dir * 4.3, y: 34 };
  const receivePoint = { x: goalX - dir * 1.5, y: 34 };
  passer.position = { ...passStart }; passer.previousPosition = { ...passStart };
  passer.facing = { x: dir, y: 0 }; passer.rng = { next: () => 0.5 };
  receiver.position = { ...receivePoint }; receiver.previousPosition = { ...receivePoint };
  receiver.facing = { x: dir, y: 0 }; receiver.rng = { next: () => 0.5 };
  const goalie = defend.activePlayers.find(p => p.isGoalkeeper);
  goalie.position = { x: goalX - dir * 0.5, y: dir > 0 ? 5 : 63 }; goalie.previousPosition = { ...goalie.position };
  m.ball.position = { x: passStart.x + dir * 0.45, y: 34, z: 0.11 };
  m.ball.previousPosition = { ...m.ball.position }; m.ball.velocity.x = m.ball.velocity.y = m.ball.velocity.z = 0;
  m.ball.ownerId = passer.id; m.ball.controlState = 'controlled'; m.ball.handControl = false;
  passer.motor = passer.intent = passer.currentAction = { type: 'throughBall', target: { ...receivePoint }, ballTarget: { ...receivePoint }, targetId: receiver.id, power: 0.3, lift: 0.9, desiredSpeed: 0 };
  receiver.motor = receiver.intent = receiver.currentAction = { type: 'header', target: { x: goalX, y: 34 }, ballTarget: { x: goalX, y: 34 }, power: 1, lift: 0, desiredSpeed: 0 };
  TF.updatePhysics(m, TF.FIXED_DT);
  assert.ok(m.events.some(e => e.type === 'pass' && e.playerId === passer.id), `${side} lofted feed uses real pass strike`);
  for (let i = 0; i < 100 && !m.events.some(e => e.type === 'goal'); i += 1) step(m);
  const headerEvent = m.events.find(e => e.type === 'header' && e.playerId === receiver.id);
  assert.ok(headerEvent, `${side} receiver makes a physical one-touch header`);
  const goalEvent = m.events.find(e => e.type === 'goal');
  assert.ok(goalEvent, `${side} physical header reaches the goal`);
  assert.equal(goalEvent.scorerId, receiver.id);
  assert.equal(goalEvent.assistId, passer.id, 'the actual targeted passer receives the header-goal assist');
}

// A deliberately targeted physical header may begin the next pass candidate.
// The state before contact is a controlled in-range lofted-ball/header fixture;
// the header itself uses the ordinary motor, launch and contact path.
{
  const m = TF.createMatch({ seed: 92023, halfSeconds: 90 }); m.state.phase = 'open-play';
  const attack = m.teams.find(t => t.side === 'home'), passer = attack.activePlayers[5], receiver = attack.activePlayers[8], targetMate = attack.activePlayers[7];
  for (const [index, p] of m.players.entries()) {
    p.position = { x: 40 + index * 0.2, y: 5 + index % 3 * 2 }; p.previousPosition = { ...p.position };
    p.velocity.x = p.velocity.y = 0; p.motor = p.intent = p.currentAction = p.action = null;
  }
  receiver.position = { x: 40, y: 34 }; receiver.previousPosition = { ...receiver.position };
  receiver.facing = { x: 1, y: 0 }; receiver.rng = { next: () => 0.5 };
  m.ball.position = { x: 40.4, y: 34, z: 1.45 }; m.ball.previousPosition = { ...m.ball.position };
  m.ball.velocity.x = m.ball.velocity.y = m.ball.velocity.z = 0; m.ball.ownerId = null; m.ball.controlState = 'flight';
  m.ball._passAssistCandidate = { passerId: passer.id, teamId: attack.id, targetId: receiver.id,
    kickTick: m.tick - 4, receivedById: null, receivedTick: null };
  receiver.motor = receiver.intent = receiver.currentAction = { type: 'header', target: { ...receiver.position },
    ballTarget: { x: 48, y: 34 }, targetId: targetMate.id, power: 0.3, lift: 0, desiredSpeed: 0 };
  TF.updatePhysics(m, TF.FIXED_DT);
  assert.ok(m.events.some(e => e.type === 'header' && e.playerId === receiver.id), 'header pass uses ordinary header motor/contact');
  assert.deepEqual(m.ball._passAssistCandidate && { passerId: m.ball._passAssistCandidate.passerId,
    targetId: m.ball._passAssistCandidate.targetId }, { passerId: receiver.id, targetId: targetMate.id },
  'an authored teammate header target starts the next pass candidate');
}

// A pass candidate is discarded by an opponent's actual control and cannot
// survive a restart or an unrelated same-team controlled possession.
const reset = fixture(92013, 'home');
TF.updatePhysics(reset.match, TF.FIXED_DT);
const opponent = reset.defend.activePlayers.find(p => !p.isGoalkeeper && p.id !== reset.priorOpponent.id);
TF.physicsHelpers.addTouch(reset.match, opponent, 'control');
assert.equal(reset.match.ball._passAssistCandidate, null);
reset.match.state.restartInProgress = null;
reset.match.state.restartSecondTouch = null;
TF.rulesLab.awardRestart(reset.match, 'goal-kick', reset.defend.id, { x: 5, y: 34 });
assert.equal(reset.match.ball._passAssistCandidate, null);

// The authoritative goal API canonicalizes identity: no opponent scorer/assist,
// no self-assist, and no assist detached from a credited teammate scorer.
const guard = fixture(92014, 'home'), invalid = guard.match.scoreGoal(guard.attack.id, guard.priorOpponent.id, guard.passer.id);
assert.equal(invalid.scorerId, null);
assert.equal(invalid.assistId, null);
assert.equal(guard.passer.stats.assists || 0, 0);
const selfAssist = guard.match.scoreGoal(guard.attack.id, guard.passer.id, guard.passer.id);
assert.equal(selfAssist.scorerId, guard.passer.id);
assert.equal(selfAssist.assistId, null);
const boundary = fixture(92015, 'home');
boundary.match.ball.previousPosition = { x: 104.8, y: 34, z: 0.11 };
boundary.match.ball.position = { x: 105.2, y: 34, z: 0.11 };
boundary.match.ball.lastTouchPlayerId = boundary.priorOpponent.id;
boundary.match.ball.lastTouchTeamId = boundary.defend.id;
boundary.match.ball.lastTouchKind = 'challenge';
boundary.match.ball._assistPlayerId = boundary.passer.id;
TF.rulesLab.inspectBoundaries(boundary.match);
const canonicalGoal = boundary.match.events.find(e => e.type === 'goal');
const confirmedGoal = boundary.match.events.find(e => e.type === 'goal-confirmed');
assert.equal(canonicalGoal.teamId, boundary.attack.id);
assert.equal(canonicalGoal.scorerId, null);
assert.equal(canonicalGoal.assistId, null);
assert.equal(confirmedGoal.scorerId, canonicalGoal.scorerId);
assert.equal(confirmedGoal.assistId, canonicalGoal.assistId);

process.stdout.write('assist provenance follows actual mirrored same-team pass receipt; stale and cross-team attribution is rejected\n');
